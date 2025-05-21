"use client";

import { useState } from "react";
import { createCustomerPortal } from "@/app/actions/subscription";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import type { Database } from "@/types/supabase";
import type { ActionResponse } from "@/types/actions";
import { Icons } from "@/components/icons";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

interface SubscriptionStatusProps {
  profile: Profile;
}

export function SubscriptionStatus({ profile }: SubscriptionStatusProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleManageSubscription = async () => {
    try {
      setIsLoading(true);
      const result = await createCustomerPortal({});

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
        console.error("No customer portal URL received from Stripe");
      }
    } catch (error) {
      console.error("Error managing subscription:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const subscriptionEndDate = profile.subscription_end_date
    ? new Date(profile.subscription_end_date)
    : null;

  const isActive = subscriptionEndDate && subscriptionEndDate > new Date();

  return (
    <Card className="max-w-2xl mx-auto bg-neutral-900 border-neutral-700 shadow-xl rounded-xl my-12">
      <CardHeader className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-3xl font-bold text-violet-400">
              Premium Subscription
            </CardTitle>
            <CardDescription className="text-neutral-400 mt-1">
              Manage your subscription settings
            </CardDescription>
          </div>
          <Badge
            variant={isActive ? "default" : "destructive"}
            className={`px-3 py-1 text-sm font-semibold rounded-full ${
              isActive
                ? "bg-green-500/20 text-green-400 border-green-500/50"
                : "bg-red-500/20 text-red-400 border-red-500/50"
            }`}
          >
            {isActive ? "Active" : "Expired"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center space-x-3 text-neutral-300 text-lg">
          <CalendarIcon className="h-6 w-6 text-violet-400 flex-shrink-0" />
          <span>
            {subscriptionEndDate
              ? isActive
                ? `Renews on ${format(subscriptionEndDate, "MMMM d, yyyy")}`
                : `Expired on ${format(subscriptionEndDate, "MMMM d, yyyy")}`
              : "No renewal date found"}
          </span>
        </div>
      </CardContent>
      <CardFooter className="p-6 border-t border-neutral-800 mt-auto">
        <Button
          onClick={handleManageSubscription}
          disabled={isLoading}
          className="w-full bg-violet-600 hover:bg-violet-700 text-white font-semibold py-3 text-lg rounded-lg transition-colors duration-300 shadow-md hover:shadow-lg disabled:opacity-50"
        >
          {isLoading ? (
            <>
              <Icons.spinner className="mr-2 h-5 w-5 animate-spin" />
              Loading...
            </>
          ) : (
            "Manage Subscription"
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}
