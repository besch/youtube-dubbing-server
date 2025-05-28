import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type Stripe from "stripe";
import type { Json } from "@/types/supabase";

export async function POST(req: Request) {
  const body = await req.text();
  const signature = headers().get("stripe-signature");

  if (!signature) {
    console.warn("Stripe webhook call missing signature");
    return new NextResponse("No signature", { status: 400 });
  }

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error("STRIPE_WEBHOOK_SECRET not configured");
    return new NextResponse("Webhook secret not configured", { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Unknown webhook construction error";
    console.error(
      `Webhook signature verification failed: ${errorMessage}`,
      error
    );
    return new NextResponse(`Webhook Error: ${errorMessage}`, { status: 400 });
  }

  console.log("Processing Stripe webhook event:", event.type, "ID:", event.id);

  const supabase = createServiceRoleClient();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      const subscriptionId = session.subscription;
      const customerId = session.customer;

      console.log("Processing checkout.session.completed:", {
        sessionId: session.id,
        userId,
        subscriptionId,
        customerId,
      });

      if (!userId) {
        console.error(
          "checkout.session.completed: No userId in session metadata",
          session.metadata
        );
        return new NextResponse("No user ID in metadata", { status: 400 });
      }
      if (!subscriptionId || typeof subscriptionId !== "string") {
        console.error(
          "checkout.session.completed: No valid subscription ID in session",
          session
        );
        return new NextResponse("No valid subscription ID in session", {
          status: 400,
        });
      }
      if (!customerId || typeof customerId !== "string") {
        console.error(
          "checkout.session.completed: No valid customer ID in session",
          session
        );
        return new NextResponse("No valid customer ID in session", {
          status: 400,
        });
      }

      let subscriptionDetails: Stripe.Subscription | null = null;
      try {
        subscriptionDetails = await stripe.subscriptions.retrieve(
          subscriptionId
        );
      } catch (stripeError: unknown) {
        console.error(
          `Error fetching subscription ${subscriptionId} from Stripe:`,
          stripeError
        );
        return new NextResponse(
          "Error fetching subscription details from Stripe",
          { status: 500 }
        );
      }

      if (!subscriptionDetails?.current_period_end) {
        console.error(
          "checkout.session.completed: Subscription details missing current_period_end",
          subscriptionDetails
        );
        return new NextResponse(
          "Subscription details missing current_period_end",
          { status: 500 }
        );
      }

      const subscriptionEndDate = new Date(
        subscriptionDetails.current_period_end * 1000
      ).toISOString();

      const { error: updateProfileError } = await supabase
        .from("profiles")
        .update({
          subscription_status: "premium",
          subscription_id: subscriptionId,
          subscription_end_date: subscriptionEndDate,
          stripe_customer_id: customerId,
        })
        .eq("id", userId);

      if (updateProfileError) {
        console.error(
          "Error updating profile for checkout.session.completed:",
          updateProfileError
        );
        return new NextResponse(
          `Error updating profile: ${updateProfileError.message}`,
          {
            status: 500,
          }
        );
      }

      const eventData: Json = {
        stripe_session_id: session.id,
        stripe_subscription_id: subscriptionId,
        subscription_end_date: subscriptionEndDate,
        plan_id: subscriptionDetails.items.data[0]?.price.id,
      };

      const { error: logEventError } = await supabase
        .from("subscription_events")
        .insert({
          user_id: userId,
          event_type: "subscription.created",
          event_data: eventData,
        });

      if (logEventError) {
        console.warn(
          "Error logging subscription event for checkout.session.completed:",
          logEventError
        );
      }

      console.log(
        "Successfully updated profile and logged event for user:",
        userId
      );
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;
      let userId = subscription.metadata?.userId;

      console.log(`Processing ${event.type}:`, {
        subscriptionId: subscription.id,
        userId,
        customerId,
        status: subscription.status,
        current_period_end: subscription.current_period_end,
      });

      if (!userId && customerId) {
        console.warn(
          `${event.type}: No userId in subscription metadata, attempting to find profile by stripe_customer_id: ${customerId}`
        );
        const { data: profileData, error: profileError } = await supabase
          .from("profiles")
          .select("id")
          .eq("stripe_customer_id", customerId)
          .single();

        if (profileError || !profileData) {
          console.error(
            `${event.type}: Profile not found for stripe_customer_id: ${customerId}. Error: ${profileError?.message}`
          );
          return new NextResponse(
            `Profile not found for customer ID ${customerId} for ${event.type}`,
            { status: 400 }
          );
        }
        userId = profileData.id;
        console.log(
          `${event.type}: Found userId ${userId} using stripe_customer_id ${customerId}`
        );
      } else if (!userId && !customerId) {
        console.error(
          `${event.type}: No userId in subscription metadata and no customerId. Cannot update profile.`,
          subscription.metadata
        );
        return new NextResponse(
          `No user ID or customer ID in metadata for ${event.type}`,
          { status: 400 }
        );
      }

      if (!userId) {
        console.error(
          `${event.type}: Could not determine userId. Profile will not be updated.`,
          subscription.metadata
        );
        return new NextResponse(
          `Could not determine User ID for ${event.type}`,
          { status: 400 }
        );
      }

      const subscriptionEndDate = subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000).toISOString()
        : null;
      const newStatus =
        subscription.status === "active" || subscription.status === "trialing"
          ? "premium"
          : "free";

      const { error: updateProfileError } = await supabase
        .from("profiles")
        .update({
          subscription_status: newStatus,
          subscription_id: subscription.id,
          subscription_end_date: subscriptionEndDate,
          stripe_customer_id: customerId,
        })
        .eq("id", userId);

      if (updateProfileError) {
        console.error(
          "Error updating profile for customer.subscription.updated:",
          updateProfileError
        );
        return new NextResponse(
          `Error updating profile: ${updateProfileError.message}`,
          { status: 500 }
        );
      }

      const eventData: Json = {
        stripe_subscription_id: subscription.id,
        new_status: subscription.status,
        current_period_end: subscriptionEndDate,
      };

      const { error: logEventError } = await supabase
        .from("subscription_events")
        .insert({
          user_id: userId,
          event_type: `subscription.${subscription.status}`,
          event_data: eventData,
        });

      if (logEventError) {
        console.warn(
          "Error logging subscription event for customer.subscription.updated:",
          logEventError
        );
      }

      console.log(
        "Successfully updated profile for user (subscription.updated):",
        userId
      );
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;
      let userId = subscription.metadata?.userId;

      console.log("Processing customer.subscription.deleted:", {
        subscriptionId: subscription.id,
        userId,
        customerId: subscription.customer,
      });

      if (!userId && customerId) {
        console.warn(
          `customer.subscription.deleted: No userId in subscription metadata, attempting to find profile by stripe_customer_id: ${customerId}`
        );
        const { data: profileData, error: profileError } = await supabase
          .from("profiles")
          .select("id")
          .eq("stripe_customer_id", customerId)
          .single();

        if (profileError || !profileData) {
          console.error(
            `customer.subscription.deleted: Profile not found for stripe_customer_id: ${customerId}. Error: ${profileError?.message}`
          );
          return new NextResponse(
            `Profile not found for customer ID ${customerId} for customer.subscription.deleted`,
            { status: 400 }
          );
        }
        userId = profileData.id;
        console.log(
          `customer.subscription.deleted: Found userId ${userId} using stripe_customer_id ${customerId}`
        );
      } else if (!userId && !customerId) {
        console.error(
          `customer.subscription.deleted: No userId in subscription metadata and no customerId. Cannot update profile.`,
          subscription.metadata
        );
        return new NextResponse(
          `No user ID or customer ID in metadata for customer.subscription.deleted`,
          { status: 400 }
        );
      }

      if (!userId) {
        console.error(
          "customer.subscription.deleted: Could not determine userId. Profile will not be updated.",
          subscription.metadata
        );
        return new NextResponse(
          "Could not determine User ID for customer.subscription.deleted.",
          { status: 400 }
        );
      }

      const { error: updateProfileError } = await supabase
        .from("profiles")
        .update({
          subscription_status: "free",
          subscription_id: null,
          subscription_end_date: null,
        })
        .eq("id", userId);

      if (updateProfileError) {
        console.error(
          "Error updating profile for customer.subscription.deleted:",
          updateProfileError
        );
        return new NextResponse(
          `Error updating profile: ${updateProfileError.message}`,
          {
            status: 500,
          }
        );
      }

      const eventData: Json = {
        stripe_subscription_id: subscription.id,
      };

      const { error: logEventError } = await supabase
        .from("subscription_events")
        .insert({
          user_id: userId,
          event_type: "subscription.deleted",
          event_data: eventData,
        });

      if (logEventError) {
        console.warn(
          "Error logging subscription event for customer.subscription.deleted:",
          logEventError
        );
      }

      console.log(
        "Successfully updated profile (subscription canceled) for user:",
        userId
      );
      break;
    }

    default:
      console.log(
        `Unhandled Stripe event type: ${event.type}. Event ID: ${event.id}`
      );
  }

  return new NextResponse(null, { status: 200 });
}
