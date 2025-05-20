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

  // Only try to get profile if user is authenticated
  if (session) {
    const { data, error: profileError } = await supabase
      .from("profiles")
      .select("id, subscription_status, stripe_customer_id, daily_video_count")
      .eq("id", session.user.id)
      .single();

    if (profileError && profileError.code !== "PGRST116") {
      console.error("Profile error details:", {
        code: profileError.code,
        message: profileError.message,
        details: profileError.details,
        hint: profileError.hint,
      });
    } else if (data) {
      profile = data;
    } else if (session) {
      // If no profile exists but user is authenticated, create one
      const { data: newProfile, error: createError } = await supabase
        .from("profiles")
        .insert({
          id: session.user.id,
          email: session.user.email,
          full_name: session.user.user_metadata?.full_name || null,
          avatar_url: session.user.user_metadata?.avatar_url || null,
          subscription_status: "free",
          daily_video_count: 0,
          settings: {
            voice_mapping: { default: "alloy" },
            default_language: "en",
          },
        })
        .select(
          "id, subscription_status, stripe_customer_id, daily_video_count"
        )
        .single();

      if (!createError) {
        profile = newProfile;
      }
    }
  }

  return (
    <div className="container py-10">
      <SubscriptionPlans profile={profile} />
    </div>
  );
}
