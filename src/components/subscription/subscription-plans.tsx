"use client";

import { useState } from "react";
import { createSubscription } from "@/app/actions/subscription";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CheckCircle2Icon } from "lucide-react";
import type { Database } from "@/types/supabase";
import type { ActionResponse } from "@/types/actions";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

interface SubscriptionPlansProps {
  profile: Profile;
}

const plans = [
  {
    name: "Monthly",
    price: "$9.99",
    description: "Billed monthly",
    priceId: process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID,
    period: "month",
  },
  {
    name: "Yearly",
    price: "$99.99",
    description: "Billed annually (Save 17%)",
    priceId: process.env.NEXT_PUBLIC_STRIPE_YEARLY_PRICE_ID,
    period: "year",
  },
];

const features = ["Unlimited video dubbing", "Cancel anytime"];

export function SubscriptionPlans({ profile }: SubscriptionPlansProps) {
  const [isLoading, setIsLoading] = useState<string | null>(null);

  const handleSubscribe = async (priceId: string) => {
    try {
      setIsLoading(priceId);
      const result = await createSubscription({ priceId });

      if (result.serverError) {
        console.error("Server error:", result.serverError);
        return;
      }

      if (result.validationError) {
        console.error("Validation error:", result.validationError);
        return;
      }

      if (result.data?.success && result.data.data?.url) {
        window.location.href = result.data.data.url;
      } else {
        console.error("No checkout URL received from Stripe");
      }
    } catch (error) {
      console.error("Error creating subscription:", error);
    } finally {
      setIsLoading(null);
    }
  };

  return (
    <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
      {plans.map((plan) => (
        <Card key={plan.name} className="flex flex-col">
          <CardHeader>
            <CardTitle className="text-2xl">{plan.name}</CardTitle>
            <div className="mt-2">
              <span className="text-4xl font-bold">{plan.price}</span>
              <span className="text-muted-foreground"> / {plan.period}</span>
            </div>
            <CardDescription>{plan.description}</CardDescription>
          </CardHeader>
          <CardContent className="flex-grow">
            <ul className="space-y-3">
              {features.map((feature) => (
                <li key={feature} className="flex items-center space-x-2">
                  <CheckCircle2Icon className="h-5 w-5 text-green-500" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter>
            <Button
              onClick={() => handleSubscribe(plan.priceId!)}
              disabled={isLoading === plan.priceId}
              className="w-full"
            >
              {isLoading === plan.priceId ? "Loading..." : "Subscribe Now"}
            </Button>
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
