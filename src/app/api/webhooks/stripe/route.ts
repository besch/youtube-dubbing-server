import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import type Stripe from "stripe";

export async function POST(req: Request) {
  const body = await req.text();
  const signature = headers().get("stripe-signature");

  if (!signature) {
    return new NextResponse("No signature", { status: 400 });
  }

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return new NextResponse("Webhook secret not configured", { status: 500 });
  }

  try {
    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    const cookieStore = cookies();
    const supabase = createClient(cookieStore);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;

        if (!userId) {
          return new NextResponse("No user ID in metadata", { status: 400 });
        }

        const { error } = await supabase
          .from("profiles")
          .update({
            subscription_status: "premium",
            subscription_id: session.subscription as string,
            subscription_end_date: new Date(
              Date.now() + 30 * 24 * 60 * 60 * 1000
            ).toISOString(), // 30 days from now
          })
          .eq("id", userId);

        if (error) {
          console.error("Error updating subscription status:", error);
          return new NextResponse("Error updating subscription", {
            status: 500,
          });
        }

        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = subscription.metadata?.userId;

        if (!userId) {
          return new NextResponse("No user ID in metadata", { status: 400 });
        }

        const { error } = await supabase
          .from("profiles")
          .update({
            subscription_status: "free",
            subscription_id: null,
            subscription_end_date: null,
          })
          .eq("id", userId);

        if (error) {
          console.error("Error updating subscription status:", error);
          return new NextResponse("Error updating subscription", {
            status: 500,
          });
        }

        break;
      }
    }

    return new NextResponse(null, { status: 200 });
  } catch (error) {
    console.error("Webhook error:", error);
    return new NextResponse(
      `Webhook Error: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      { status: 400 }
    );
  }
}
