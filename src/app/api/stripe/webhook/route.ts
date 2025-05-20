import { NextRequest } from "next/server";
import { handleStripeWebhook } from "@/app/actions/subscription";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2023-10-16",
});

export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

  if (!sig || !webhookSecret) {
    return new Response("Missing Stripe signature or webhook secret", {
      status: 400,
    });
  }

  let event: Stripe.Event;
  const buf = await req.arrayBuffer();
  try {
    event = stripe.webhooks.constructEvent(
      Buffer.from(buf),
      sig,
      webhookSecret
    );
  } catch (err) {
    return new Response(`Webhook Error: ${(err as Error).message}`, {
      status: 400,
    });
  }

  const result = await handleStripeWebhook(event);
  if (result.success) {
    return new Response("Webhook handled", { status: 200 });
  } else {
    return new Response(result.error || "Webhook failed", { status: 500 });
  }
}
