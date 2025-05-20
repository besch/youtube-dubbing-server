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
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-2xl">Premium Subscription</CardTitle>
            <CardDescription>Manage your subscription settings</CardDescription>
          </div>
          <Badge variant={isActive ? "default" : "destructive"}>
            {isActive ? "Active" : "Expired"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center space-x-2 text-muted-foreground">
          <CalendarIcon className="h-5 w-5" />
          <span>
            {subscriptionEndDate
              ? isActive
                ? `Renews on ${format(subscriptionEndDate, "MMMM d, yyyy")}`
                : `Expired on ${format(subscriptionEndDate, "MMMM d, yyyy")}`
              : "No renewal date found"}
          </span>
        </div>
      </CardContent>
      <CardFooter>
        <Button
          onClick={handleManageSubscription}
          disabled={isLoading}
          className="w-full"
        >
          {isLoading ? "Loading..." : "Manage Subscription"}
        </Button>
      </CardFooter>
    </Card>
  );
}
