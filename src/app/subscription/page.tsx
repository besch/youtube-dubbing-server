import { Metadata } from "next";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { SubscriptionPlans } from "@/components/subscription/subscription-plans";

export const metadata: Metadata = {
  title: "Subscription",
  description: "Choose your subscription plan",
};

export default async function SubscriptionPage() {
  const cookieStore = cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg">Please sign in to view subscription plans.</p>
      </div>
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", session.user.id)
    .single();

  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg">Profile not found.</p>
      </div>
    );
  }

  return (
    <div className="container py-8">
      <SubscriptionPlans
        currentPlan={profile.subscription_status as "free" | "premium"}
        userId={session.user.id}
      />
    </div>
  );
}
