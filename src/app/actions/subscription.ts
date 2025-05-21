"use server";

import { createSafeActionClient } from "next-safe-action";
import { z } from "zod";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import { AppError, appErrors } from "@/lib/errors";
import type { ActionResponse, ActionError } from "@/types/actions";
import type Stripe from "stripe";

const createSubscriptionSchema = z.object({
  priceId: z.string(),
});

const checkVideoLimitSchema = z.object({
  userId: z.string(),
});

const updateIpAddressSchema = z.object({
  userId: z.string(),
  ipAddress: z.string(),
});

const action = createSafeActionClient();

export const createSubscription = action(
  createSubscriptionSchema,
  async ({ priceId }): Promise<ActionResponse<{ url: string }>> => {
    try {
      console.log("Starting subscription creation with priceId:", priceId);

      if (!process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID) {
        console.error(
          "Missing NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID environment variable"
        );
        return {
          success: false,
          error: {
            message: "Server configuration error",
            code: "CONFIG_ERROR",
          },
        };
      }

      if (!process.env.NEXT_PUBLIC_APP_URL) {
        console.error("Missing NEXT_PUBLIC_APP_URL environment variable");
        return {
          success: false,
          error: {
            message: "Server configuration error",
            code: "CONFIG_ERROR",
          },
        };
      }

      const cookieStore = cookies();
      const supabase = createClient(cookieStore);

      // Get session first
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      console.log("Session check:", {
        hasSession: !!session,
        error: sessionError,
        userId: session?.user?.id,
      });

      if (sessionError) {
        console.error("Session error:", sessionError);
        return {
          success: false,
          error: {
            message: "Authentication error",
            code: "AUTH_ERROR",
          },
        };
      }

      if (!session?.user) {
        console.error("No user in session");
        return {
          success: false,
          error: {
            message: "Authentication required",
            code: "UNAUTHORIZED",
          },
        };
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", session.user.id)
        .single();

      console.log("Profile fetch:", {
        profile: !!profile,
        error: profileError,
        userId: session.user.id,
      });

      if (!profile) {
        console.error("Profile not found for user:", session.user.id);
        return {
          success: false,
          error: {
            message: "Profile not found",
            code: "NOT_FOUND",
          },
        };
      }

      // Create a new Stripe customer
      console.log("Creating new Stripe customer for user:", session.user.id);
      const customer = await stripe.customers.create({
        email: session.user.email,
        metadata: {
          userId: session.user.id,
        },
      });

      console.log("New customer created:", customer.id);

      // Create a subscription event record
      const { error: eventError } = await supabase
        .from("subscription_events")
        .insert({
          user_id: session.user.id,
          event_type: "subscription_created",
          event_data: {
            customer_id: customer.id,
            price_id: priceId,
          },
        });

      if (eventError) {
        console.error("Error creating subscription event:", eventError);
        return {
          success: false,
          error: {
            message: "Failed to create subscription event",
            code: "DATABASE_ERROR",
          },
        };
      }

      console.log("Creating Stripe checkout session");
      const checkoutSession = await stripe.checkout.sessions.create({
        customer: customer.id,
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        mode: "subscription",
        success_url: `${process.env.NEXT_PUBLIC_APP_URL}/subscription?success=true`,
        cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/subscription?canceled=true`,
        metadata: {
          userId: session.user.id,
        },
      });

      console.log("Checkout session created:", {
        sessionId: checkoutSession.id,
        hasUrl: !!checkoutSession.url,
      });

      if (!checkoutSession.url) {
        console.error("No checkout URL in session");
        return {
          success: false,
          error: {
            message: "Failed to create checkout session",
            code: "STRIPE_ERROR",
          },
        };
      }

      return { success: true, data: { url: checkoutSession.url } };
    } catch (error) {
      console.error("Subscription creation error:", error);
      return {
        success: false,
        error: {
          message:
            error instanceof Error
              ? error.message
              : "An unexpected error occurred",
          code: "UNEXPECTED_ERROR",
        },
      };
    }
  }
);

export const createCustomerPortal = action(
  z.object({}),
  async (): Promise<ActionResponse<{ url: string }>> => {
    try {
      const cookieStore = cookies();
      const supabase = createClient(cookieStore);

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (!user || userError) {
        return {
          success: false,
          error: {
            message: appErrors.UNAUTHORIZED.message,
            code: appErrors.UNAUTHORIZED.code,
          },
        };
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("subscription_id")
        .eq("id", user.id)
        .single();

      if (!profile?.subscription_id) {
        return {
          success: false,
          error: {
            message: appErrors.NOT_FOUND.message,
            code: appErrors.NOT_FOUND.code,
          },
        };
      }

      // Get the subscription from Stripe
      const subscription = await stripe.subscriptions.retrieve(
        profile.subscription_id
      );
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: subscription.customer as string,
        return_url: `${process.env.NEXT_PUBLIC_APP_URL}/subscription`,
      });

      return { success: true, data: { url: portalSession.url } };
    } catch (error) {
      console.error("Customer portal error:", error);
      let errorResponse: ActionError;
      if (error instanceof AppError) {
        errorResponse = { message: error.message, code: error.code };
      } else if (error instanceof Error) {
        errorResponse = { message: error.message, code: "STRIPE_CLIENT_ERROR" };
      } else {
        errorResponse = {
          message: appErrors.UNEXPECTED_ERROR.message,
          code: appErrors.UNEXPECTED_ERROR.code,
        };
      }
      return {
        success: false,
        error: errorResponse,
      };
    }
  }
);

export const checkVideoLimit = action(
  checkVideoLimitSchema,
  async ({
    userId,
  }): Promise<
    ActionResponse<{
      canProcess: boolean;
      dailyVideoCount: number;
      remainingVideos: number;
    }>
  > => {
    try {
      const cookieStore = cookies();
      const supabase = createClient(cookieStore);

      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (!profile) {
        return { success: false, error: appErrors.NOT_FOUND };
      }

      if (profile.subscription_status === "premium") {
        return {
          success: true,
          data: {
            canProcess: true,
            dailyVideoCount: 0,
            remainingVideos: Infinity,
          },
        };
      }

      const { data: videos } = await supabase
        .from("videos")
        .select("created_at")
        .eq("user_id", userId)
        .gte("created_at", new Date().toISOString().split("T")[0])
        .order("created_at", { ascending: false });

      const dailyVideoCount = videos?.length ?? 0;
      const canProcess = dailyVideoCount < 3;

      return {
        success: true,
        data: {
          canProcess,
          dailyVideoCount,
          remainingVideos: Math.max(0, 3 - dailyVideoCount),
        },
      };
    } catch (error) {
      console.error("Video limit check error:", error);
      return {
        success: false,
        error: error instanceof AppError ? error : appErrors.UNEXPECTED_ERROR,
      };
    }
  }
);

export const updateIpAddress = action(
  updateIpAddressSchema,
  async ({ userId, ipAddress }): Promise<ActionResponse> => {
    try {
      const cookieStore = cookies();
      const supabase = createClient(cookieStore);

      const { error } = await supabase
        .from("profiles")
        .update({ last_ip_address: ipAddress })
        .eq("id", userId);

      if (error) {
        throw new AppError("Failed to update IP address", "DATABASE_ERROR");
      }

      return { success: true };
    } catch (error) {
      console.error("IP address update error:", error);
      return {
        success: false,
        error: error instanceof AppError ? error : appErrors.UNEXPECTED_ERROR,
      };
    }
  }
);

// Handle Stripe webhook
export const handleStripeWebhook = async (
  event: Stripe.Event
): Promise<{ success: boolean; error?: string }> => {
  const cookieStore = cookies();
  const supabase = createClient(cookieStore);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;

        if (!userId) {
          console.error(
            "Webhook Error: No user ID in session metadata for checkout.session.completed"
          );
          return { success: false, error: "No user ID in session metadata" };
        }

        // Update user's subscription status
        const { error } = await supabase
          .from("profiles")
          .update({
            subscription_status: "premium",
            subscription_id: session.subscription as string,
          })
          .eq("id", userId);

        if (error) {
          console.error(
            "Webhook Error: Failed to update subscription status for checkout.session.completed",
            error
          );
          return {
            success: false,
            error: "Failed to update subscription status",
          };
        }
        console.log(
          `Webhook: Successfully processed checkout.session.completed for user ${userId}`
        );
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        if (!customerId) {
          console.error(
            "Webhook Error: No customer ID on subscription for customer.subscription.deleted"
          );
          return { success: false, error: "No customer ID on subscription" };
        }

        const customer = await stripe.customers.retrieve(customerId);
        if (customer.deleted || !customer.metadata?.userId) {
          console.error(
            "Webhook Error: Customer deleted or no userId in customer metadata for customer.subscription.deleted"
          );
          return {
            success: false,
            error: "Customer deleted or no user ID in customer metadata",
          };
        }
        const userId = customer.metadata.userId;

        // Update user's subscription status
        const { error } = await supabase
          .from("profiles")
          .update({
            subscription_status: "free",
            subscription_id: null,
          })
          .eq("id", userId);

        if (error) {
          console.error(
            "Webhook Error: Failed to update subscription status for customer.subscription.deleted",
            error
          );
          return {
            success: false,
            error: "Failed to update subscription status",
          };
        }
        console.log(
          `Webhook: Successfully processed customer.subscription.deleted for user ${userId}`
        );
        break;
      }
      default:
        console.log(`Webhook: Unhandled event type ${event.type}`);
    }
    return { success: true };
  } catch (error) {
    console.error("Webhook processing error:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "An unknown error occurred during webhook processing",
    };
  }
};
