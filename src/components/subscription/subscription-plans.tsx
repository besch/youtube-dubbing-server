"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Icons } from "@/components/icons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  createSubscription,
  createCustomerPortal,
} from "@/app/actions/subscription";
import { toast } from "sonner";

interface SubscriptionPlansProps {
  currentPlan: "free" | "premium";
  userId: string;
}

export function SubscriptionPlans({
  currentPlan,
  userId,
}: SubscriptionPlansProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [billingInterval, setBillingInterval] = useState<"monthly" | "yearly">(
    "monthly"
  );

  const handleSubscribe = async (priceId: string) => {
    try {
      setIsLoading(true);
      const result = await createSubscription({ priceId });

      if (!result.data?.success || !result.data.data?.url) {
        throw new Error(result.serverError || "Failed to create subscription");
      }

      router.push(result.data.data.url);
    } catch (error) {
      console.error("Subscription error:", error);
      toast.error("Failed to create subscription. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleManageSubscription = async () => {
    try {
      setIsLoading(true);
      const result = await createCustomerPortal({});

      if (!result.data?.success || !result.data.data?.url) {
        throw new Error(
          result.serverError || "Failed to create customer portal session"
        );
      }

      router.push(result.data.data.url);
    } catch (error) {
      console.error("Customer portal error:", error);
      toast.error("Failed to open customer portal. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto p-4">
      <Tabs
        defaultValue="monthly"
        value={billingInterval}
        onValueChange={(value) =>
          setBillingInterval(value as "monthly" | "yearly")
        }
        className="w-full"
      >
        <div className="flex flex-col items-center gap-4 mb-8">
          <h2 className="text-3xl font-bold">Choose Your Plan</h2>
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="monthly">Monthly</TabsTrigger>
            <TabsTrigger value="yearly">
              Yearly
              <Badge variant="secondary" className="ml-2">
                Save 17%
              </Badge>
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <TabsContent value="monthly">
            <Card className="p-6">
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="text-2xl font-bold">Free</h3>
                  <p className="text-muted-foreground">
                    Basic features for casual users
                  </p>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold">$0</span>
                  <span className="text-muted-foreground">/month</span>
                </div>
                <ul className="space-y-2">
                  <li className="flex items-center gap-2">
                    <Icons.check className="h-4 w-4 text-green-500" />
                    <span>3 videos per day</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Icons.check className="h-4 w-4 text-green-500" />
                    <span>Basic audio quality</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Icons.check className="h-4 w-4 text-green-500" />
                    <span>Standard processing speed</span>
                  </li>
                </ul>
                {currentPlan === "free" ? (
                  <Button disabled className="w-full">
                    Current Plan
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    onClick={handleManageSubscription}
                    disabled={isLoading}
                    className="w-full"
                  >
                    {isLoading && (
                      <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Manage Subscription
                  </Button>
                )}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="monthly">
            <Card className="p-6 border-primary">
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="text-2xl font-bold">Premium</h3>
                  <p className="text-muted-foreground">
                    Advanced features for power users
                  </p>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold">$9.99</span>
                  <span className="text-muted-foreground">/month</span>
                </div>
                <ul className="space-y-2">
                  <li className="flex items-center gap-2">
                    <Icons.check className="h-4 w-4 text-green-500" />
                    <span>Unlimited videos</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Icons.check className="h-4 w-4 text-green-500" />
                    <span>High-quality audio</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Icons.check className="h-4 w-4 text-green-500" />
                    <span>Priority processing</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Icons.check className="h-4 w-4 text-green-500" />
                    <span>Advanced customization</span>
                  </li>
                </ul>
                {currentPlan === "premium" ? (
                  <Button
                    variant="outline"
                    onClick={handleManageSubscription}
                    disabled={isLoading}
                    className="w-full"
                  >
                    {isLoading && (
                      <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Manage Subscription
                  </Button>
                ) : (
                  <Button
                    onClick={() =>
                      handleSubscribe(
                        process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID!
                      )
                    }
                    disabled={isLoading}
                    className="w-full"
                  >
                    {isLoading && (
                      <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Subscribe Now
                  </Button>
                )}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="yearly">
            <Card className="p-6">
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="text-2xl font-bold">Free</h3>
                  <p className="text-muted-foreground">
                    Basic features for casual users
                  </p>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold">$0</span>
                  <span className="text-muted-foreground">/year</span>
                </div>
                <ul className="space-y-2">
                  <li className="flex items-center gap-2">
                    <Icons.check className="h-4 w-4 text-green-500" />
                    <span>3 videos per day</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Icons.check className="h-4 w-4 text-green-500" />
                    <span>Basic audio quality</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Icons.check className="h-4 w-4 text-green-500" />
                    <span>Standard processing speed</span>
                  </li>
                </ul>
                {currentPlan === "free" ? (
                  <Button disabled className="w-full">
                    Current Plan
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    onClick={handleManageSubscription}
                    disabled={isLoading}
                    className="w-full"
                  >
                    {isLoading && (
                      <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Manage Subscription
                  </Button>
                )}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="yearly">
            <Card className="p-6 border-primary">
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="text-2xl font-bold">Premium</h3>
                  <p className="text-muted-foreground">
                    Advanced features for power users
                  </p>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold">$99.99</span>
                  <span className="text-muted-foreground">/year</span>
                </div>
                <ul className="space-y-2">
                  <li className="flex items-center gap-2">
                    <Icons.check className="h-4 w-4 text-green-500" />
                    <span>Unlimited videos</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Icons.check className="h-4 w-4 text-green-500" />
                    <span>High-quality audio</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Icons.check className="h-4 w-4 text-green-500" />
                    <span>Priority processing</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Icons.check className="h-4 w-4 text-green-500" />
                    <span>Advanced customization</span>
                  </li>
                </ul>
                {currentPlan === "premium" ? (
                  <Button
                    variant="outline"
                    onClick={handleManageSubscription}
                    disabled={isLoading}
                    className="w-full"
                  >
                    {isLoading && (
                      <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Manage Subscription
                  </Button>
                ) : (
                  <Button
                    onClick={() =>
                      handleSubscribe(
                        process.env.NEXT_PUBLIC_STRIPE_YEARLY_PRICE_ID!
                      )
                    }
                    disabled={isLoading}
                    className="w-full"
                  >
                    {isLoading && (
                      <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Subscribe Now
                  </Button>
                )}
              </div>
            </Card>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
