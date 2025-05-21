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
import { Icons } from "@/components/icons";

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
    <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto py-12">
      {plans.map((plan) => (
        <Card
          key={plan.name}
          className="flex flex-col bg-neutral-900 border-neutral-700 shadow-xl hover:shadow-purple-500/30 transition-shadow duration-300 rounded-xl"
        >
          <CardHeader className="p-6">
            <CardTitle className="text-3xl font-bold text-violet-400">
              {plan.name}
            </CardTitle>
            <div className="mt-3">
              <span className="text-5xl font-extrabold text-white">
                {plan.price}
              </span>
              <span className="text-neutral-400 text-lg"> / {plan.period}</span>
            </div>
            <CardDescription className="text-neutral-400 mt-1">
              {plan.description}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-grow p-6">
            <ul className="space-y-4">
              {features.map((feature) => (
                <li key={feature} className="flex items-center space-x-3">
                  <CheckCircle2Icon className="h-6 w-6 text-green-500 flex-shrink-0" />
                  <span className="text-neutral-300 text-lg">{feature}</span>
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter className="p-6 mt-auto">
            <Button
              onClick={() => handleSubscribe(plan.priceId!)}
              disabled={isLoading === plan.priceId}
              className="w-full bg-violet-600 hover:bg-violet-700 text-white font-semibold py-3 text-lg rounded-lg transition-colors duration-300 shadow-md hover:shadow-lg disabled:opacity-50"
            >
              {isLoading === plan.priceId ? (
                <>
                  <Icons.spinner className="mr-2 h-5 w-5 animate-spin" />
                  Processing...
                </>
              ) : (
                "Subscribe Now"
              )}
            </Button>
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
