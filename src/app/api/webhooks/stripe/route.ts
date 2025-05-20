import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";

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
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const userId = subscription.metadata.userId;

        if (!userId) {
          return new NextResponse("No user ID in metadata", { status: 400 });
        }

        const { error } = await supabase
          .from("profiles")
          .update({
            subscription_status:
              subscription.status === "active" ? "premium" : "free",
            subscription_id: subscription.id,
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
        const subscription = event.data.object;
        const userId = subscription.metadata.userId;

        if (!userId) {
          return new NextResponse("No user ID in metadata", { status: 400 });
        }

        const { error } = await supabase
          .from("profiles")
          .update({
            subscription_status: "free",
            subscription_id: null,
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
