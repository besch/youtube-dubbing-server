"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Icons } from "@/components/icons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  createSubscription,
  createCustomerPortal,
} from "@/app/actions/subscription";
import { toast } from "sonner";
import { Check } from "lucide-react";
import type { Database } from "@/types/supabase";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

interface SubscriptionPlansProps {
  profile: Profile | null;
}

export function SubscriptionPlans({ profile }: SubscriptionPlansProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const currentPlan = profile?.subscription_status || "free";

  const handleUpgrade = async () => {
    if (!profile) {
      // Redirect to login with return URL
      router.push(`/login?redirectTo=/subscription`);
      return;
    }

    try {
      setIsLoading(true);
      const result = await createSubscription({
        priceId: process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID!,
      });

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
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Subscription Plans</h3>
        <p className="text-sm text-muted-foreground">
          Choose the plan that best fits your needs
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Free Plan</CardTitle>
            <CardDescription>Basic features for casual users</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center">
                <Check className="mr-2 h-4 w-4 text-green-500" />
                <span>Basic dubbing features</span>
              </div>
              <div className="flex items-center">
                <Check className="mr-2 h-4 w-4 text-green-500" />
                <span>Standard quality audio</span>
              </div>
              <div className="flex items-center">
                <Check className="mr-2 h-4 w-4 text-green-500" />
                <span>Limited monthly usage</span>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button
              variant={currentPlan === "free" ? "default" : "outline"}
              className="w-full"
              disabled={currentPlan === "free"}
              onClick={handleManageSubscription}
            >
              {currentPlan === "free" ? "Current Plan" : "Downgrade"}
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Premium Plan</CardTitle>
            <CardDescription>Advanced features for power users</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center">
                <Check className="mr-2 h-4 w-4 text-green-500" />
                <span>All Free features</span>
              </div>
              <div className="flex items-center">
                <Check className="mr-2 h-4 w-4 text-green-500" />
                <span>High-quality audio</span>
              </div>
              <div className="flex items-center">
                <Check className="mr-2 h-4 w-4 text-green-500" />
                <span>Unlimited usage</span>
              </div>
              <div className="flex items-center">
                <Check className="mr-2 h-4 w-4 text-green-500" />
                <span>Priority support</span>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button
              variant={currentPlan === "premium" ? "default" : "outline"}
              className="w-full"
              disabled={isLoading}
              onClick={
                currentPlan === "premium"
                  ? handleManageSubscription
                  : handleUpgrade
              }
            >
              {isLoading ? (
                <span className="flex items-center">
                  <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Processing...
                </span>
              ) : currentPlan === "premium" ? (
                "Manage Subscription"
              ) : (
                "Upgrade to Premium"
              )}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
