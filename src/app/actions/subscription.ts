"use server";

import { createSafeActionClient } from "next-safe-action";
import { z } from "zod";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import { AppError, appErrors } from "@/lib/errors";
import type { ActionResponse } from "@/types/actions";
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

      let customerId = profile.stripe_customer_id;
      console.log("Existing customer ID:", customerId);

      if (!customerId) {
        console.log("Creating new Stripe customer for user:", session.user.id);
        const customer = await stripe.customers.create({
          email: session.user.email,
          metadata: {
            userId: session.user.id,
          },
        });
        customerId = customer.id;
        console.log("New customer created:", customerId);

        const { error: updateError } = await supabase
          .from("profiles")
          .update({ stripe_customer_id: customerId })
          .eq("id", session.user.id);

        if (updateError) {
          console.error(
            "Error updating profile with customer ID:",
            updateError
          );
          return {
            success: false,
            error: {
              message: "Failed to update profile",
              code: "DATABASE_ERROR",
            },
          };
        }
      }

      console.log("Creating Stripe checkout session");
      const checkoutSession = await stripe.checkout.sessions.create({
        customer: customerId,
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
        return { success: false, error: appErrors.UNAUTHORIZED };
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (!profile?.stripe_customer_id) {
        return { success: false, error: appErrors.NOT_FOUND };
      }

      const portalSession = await stripe.billingPortal.sessions.create({
        customer: profile.stripe_customer_id,
        return_url: `${process.env.NEXT_PUBLIC_APP_URL}/subscription`,
      });

      return { success: true, data: { url: portalSession.url } };
    } catch (error) {
      console.error("Customer portal error:", error);
      return {
        success: false,
        error: error instanceof AppError ? error : appErrors.UNEXPECTED_ERROR,
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
export const handleStripeWebhook = async (event: Stripe.Event) => {
  const cookieStore = cookies();
  const supabase = createClient(cookieStore);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;

        if (!userId) {
          throw new Error("No user ID in session metadata");
        }

        // Update user's subscription status
        const { error } = await supabase
          .from("profiles")
          .update({
            subscription_status: "premium",
            stripe_subscription_id: session.subscription as string,
          })
          .eq("id", userId);

        if (error) {
          throw new Error("Failed to update subscription status");
        }
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customer = (await stripe.customers.retrieve(
          subscription.customer as string
        )) as Stripe.Customer;
        const userId = customer.metadata.userId;

        if (!userId) {
          throw new Error("No user ID in customer metadata");
        }

        // Update user's subscription status
        const { error } = await supabase
          .from("profiles")
          .update({
            subscription_status: "free",
            stripe_subscription_id: null,
          })
          .eq("id", userId);

        if (error) {
          throw new Error("Failed to update subscription status");
        }
        break;
      }
    }
  } catch (error) {
    console.error("Webhook error:", error);
    throw error;
  }
};
