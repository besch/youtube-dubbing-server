import { Metadata } from "next";
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { SubscriptionPlans } from "@/components/subscription/subscription-plans";

export const metadata: Metadata = {
  title: "Subscription",
  description: "Choose your subscription plan",
};

export default async function SubscriptionPage() {
  const supabase = createServerComponentClient({ cookies });

  const {
    data: { session },
  } = await supabase.auth.getSession();

  let profile = null;
  if (session) {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .single();
    profile = data;
  }

  return (
    <div className="container py-10">
      <SubscriptionPlans profile={profile} />
    </div>
  );
}
