import { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SubscriptionPlans } from "@/components/subscription/subscription-plans";
import { SubscriptionStatus } from "@/components/subscription/subscription-status";

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
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", session.user.id)
    .single();

  if (!profile) {
    redirect("/login");
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">Subscription</h1>

      {profile.subscription_status === "premium" ? (
        <SubscriptionStatus profile={profile} />
      ) : (
        <SubscriptionPlans profile={profile} />
      )}
    </div>
  );
}
