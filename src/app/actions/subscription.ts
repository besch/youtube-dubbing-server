"use server";

import { createSafeActionClient } from "next-safe-action";
import { z } from "zod";
import { cookies } from "next/headers";
import { createClient as createServerContextClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import { AppError, appErrors } from "@/lib/errors";
import type { ActionResponse, ActionError } from "@/types/actions";
import type Stripe from "stripe";
import { createClient as createAdminSupabaseClient } from "@supabase/supabase-js";
import { FREE_TIER_VIDEO_LIMIT } from "@/config/constants";

const createSubscriptionSchema = z.object({
  priceId: z.string(),
});

const checkVideoLimitSchema = z.object({
  videoUrlToCheck: z.string().optional(),
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
      const supabase = createServerContextClient(cookieStore);

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

      console.log("Creating new Stripe customer for user:", session.user.id);
      const customer = await stripe.customers.create({
        email: session.user.email,
        metadata: {
          userId: session.user.id,
        },
      });

      console.log("New customer created:", customer.id);

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
      const supabase = createServerContextClient(cookieStore);

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
        .select("stripe_customer_id")
        .eq("id", user.id)
        .single();

      if (!profile?.stripe_customer_id) {
        return {
          success: false,
          error: {
            message: "User has no active subscription or customer ID.",
            code: appErrors.NOT_FOUND.code,
          },
        };
      }

      const portalSession = await stripe.billingPortal.sessions.create({
        customer: profile.stripe_customer_id,
        return_url: `${process.env.NEXT_PUBLIC_APP_URL}/subscription`,
      });

      return { success: true, data: { url: portalSession.url } };
    } catch (error) {
      console.error("Customer portal error:", error);
      let errorResponse: ActionError;
      if (error instanceof AppError) {
        errorResponse = { message: error.message, code: error.code };
      } else if (error instanceof Error) {
        if ((error as any).type && (error as any).type.startsWith("Stripe")) {
          errorResponse = { message: error.message, code: "STRIPE_API_ERROR" };
        } else {
          errorResponse = { message: error.message, code: "UNEXPECTED_ERROR" };
        }
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
    videoUrlToCheck,
  }): Promise<
    ActionResponse<{
      canProcess: boolean;
      dailyProcessedVideoCount: number;
      remainingVideos: number;
      isPremium: boolean;
    }>
  > => {
    try {
      const cookieStore = cookies();
      const supabase = createServerContextClient(cookieStore);

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError || !user) {
        return { success: false, error: appErrors.UNAUTHORIZED };
      }

      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("subscription_status, id")
        .eq("id", user.id)
        .single();

      if (profileError || !profileData) {
        return { success: false, error: appErrors.NOT_FOUND };
      }

      const isPremium = profileData.subscription_status === "premium";

      if (isPremium) {
        return {
          success: true,
          data: {
            canProcess: true,
            dailyProcessedVideoCount: 0,
            remainingVideos: Infinity,
            isPremium: true,
          },
        };
      }

      const now = new Date();
      const startOfDayUTC = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
      ).toISOString();
      const endOfDayUTC = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() + 1,
          0,
          0,
          0,
          -1
        )
      ).toISOString();

      const { count: dailyProcessedVideoCount, error: countError } =
        await supabase
          .from("daily_video_limits")
          .select("video_id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .gte("created_at", startOfDayUTC)
          .lte("created_at", endOfDayUTC);

      if (countError) {
        console.error("Error counting processed videos:", countError);
        return { success: false, error: appErrors.UNEXPECTED_ERROR };
      }

      const currentCount = dailyProcessedVideoCount || 0;
      let canProcessThisVideo = currentCount < FREE_TIER_VIDEO_LIMIT;
      let videoAlreadyProcessedToday = false;

      if (videoUrlToCheck) {
        const { data: specificVideoProcessed, error: specificVideoError } =
          await supabase
            .from("daily_video_limits")
            .select("id")
            .eq("user_id", user.id)
            .eq("video_id", videoUrlToCheck)
            .gte("created_at", startOfDayUTC)
            .lte("created_at", endOfDayUTC)
            .maybeSingle();

        if (specificVideoError) {
          console.error("Error checking specific video:", specificVideoError);
          return { success: false, error: appErrors.UNEXPECTED_ERROR };
        }

        if (specificVideoProcessed) {
          videoAlreadyProcessedToday = true;
          canProcessThisVideo = true;
        }
      }

      let finalProcessedCount = currentCount;
      if (!videoAlreadyProcessedToday && canProcessThisVideo) {
        if (videoUrlToCheck) {
          const { error: insertError } = await supabase
            .from("daily_video_limits")
            .insert({
              user_id: user.id,
              video_id: videoUrlToCheck,
            });
          if (insertError) {
            console.error(
              "Error inserting new video processing record:",
              insertError
            );
            return { success: false, error: appErrors.UNEXPECTED_ERROR };
          }
          finalProcessedCount++;
        }
      }

      const remainingVideos = Math.max(
        0,
        FREE_TIER_VIDEO_LIMIT - finalProcessedCount
      );

      return {
        success: true,
        data: {
          canProcess: canProcessThisVideo,
          dailyProcessedVideoCount: finalProcessedCount,
          remainingVideos: remainingVideos,
          isPremium: false,
        },
      };
    } catch (error) {
      console.error("Unexpected error in checkVideoLimit:", error);
      if (error instanceof AppError) {
        return { success: false, error: error };
      }
      return { success: false, error: appErrors.UNEXPECTED_ERROR };
    }
  }
);

export const updateIpAddress = action(
  updateIpAddressSchema,
  async ({ userId, ipAddress }): Promise<ActionResponse> => {
    try {
      const cookieStore = cookies();
      const supabase = createServerContextClient(cookieStore);

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

export const handleStripeWebhook = async (
  event: Stripe.Event
): Promise<{ success: boolean; error?: string }> => {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    console.error(
      "Supabase URL or Service Role Key is not defined for webhook admin client."
    );
    return {
      success: false,
      error: "Server configuration error for webhooks.",
    };
  }
  const supabaseAdmin = createAdminSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        const subscriptionId = session.subscription as string;
        const customerId = session.customer as string;

        if (!userId || !subscriptionId || !customerId) {
          console.error(
            "Webhook Error: Missing userId, subscriptionId, or customerId in session metadata for checkout.session.completed"
          );
          return { success: false, error: "Missing IDs in session metadata" };
        }

        const subscription = await stripe.subscriptions.retrieve(
          subscriptionId
        );
        const currentPeriodEnd = new Date(
          subscription.current_period_end * 1000
        ).toISOString();

        const { error } = await supabaseAdmin
          .from("profiles")
          .update({
            subscription_status: "premium",
            subscription_id: subscriptionId,
            stripe_customer_id: customerId,
            subscription_end_date: currentPeriodEnd,
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
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        const { data: profile, error: profileError } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("stripe_customer_id", customerId)
          .single();

        if (profileError || !profile) {
          console.error(
            `Webhook Error: Profile not found for customer ID ${customerId} during customer.subscription.updated`
          );
          return { success: false, error: "Profile not found for customer ID" };
        }
        const userId = profile.id;

        const newStatus =
          subscription.status === "active" || subscription.status === "trialing"
            ? "premium"
            : "free";
        const currentPeriodEnd = new Date(
          subscription.current_period_end * 1000
        ).toISOString();

        const { error: updateError } = await supabaseAdmin
          .from("profiles")
          .update({
            subscription_status: newStatus,
            subscription_id: subscription.id,
            subscription_end_date: currentPeriodEnd,
          })
          .eq("id", userId);

        if (updateError) {
          console.error(
            "Webhook Error: Failed to update subscription status for customer.subscription.updated",
            updateError
          );
          return {
            success: false,
            error: "Failed to update subscription status",
          };
        }
        console.log(
          `Webhook: Successfully processed customer.subscription.updated for user ${userId} to status ${newStatus}`
        );
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        const { data: profile, error: profileError } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("stripe_customer_id", customerId)
          .single();

        if (profileError || !profile) {
          console.error(
            `Webhook Error: Profile not found for customer ID ${customerId} during customer.subscription.deleted`
          );
          return { success: false, error: "Profile not found for customer ID" };
        }
        const userId = profile.id;

        const { error } = await supabaseAdmin
          .from("profiles")
          .update({
            subscription_status: "free",
            subscription_id: null,
            subscription_end_date: null,
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
