import { Metadata } from "next";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SubscriptionPlans } from "@/components/subscription/subscription-plans";

export const metadata: Metadata = {
  title: "Subscription",
  description: "Choose your subscription plan",
};

export default async function SubscriptionPage() {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: any) {
          cookieStore.set({ name, value: "", ...options });
        },
      },
    }
  );

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  let profile = null;

  // Only try to get profile if user is authenticated
  if (user && !userError) {
    const { data, error: profileError } = await supabase
      .from("profiles")
      .select("id, subscription_status, daily_video_count")
      .eq("id", user.id)
      .single();

    if (profileError && profileError.code !== "PGRST116") {
      console.error("Profile error details:", {
        code: profileError.code,
        message: profileError.message,
        details: profileError.details,
        hint: profileError.hint,
      });
    } else if (data) {
      // Create a plain object with only the needed fields
      profile = {
        id: data.id,
        subscription_status: data.subscription_status,
        daily_video_count: data.daily_video_count,
      };
    } else {
      // If no profile exists but user is authenticated, create one
      const { data: newProfile, error: createError } = await supabase
        .from("profiles")
        .insert({
          id: user.id,
          email: user.email,
          full_name: user.user_metadata?.full_name || null,
          avatar_url: user.user_metadata?.avatar_url || null,
          subscription_status: "free",
          daily_video_count: 0,
          settings: {
            voice_mapping: { default: "alloy" },
            default_language: "en",
          },
        })
        .select("id, subscription_status, daily_video_count")
        .single();

      if (!createError && newProfile) {
        // Create a plain object with only the needed fields
        profile = {
          id: newProfile.id,
          subscription_status: newProfile.subscription_status,
          daily_video_count: newProfile.daily_video_count,
        };
      }
    }
  }

  // Create a serializable profile object
  const serializedProfile = profile
    ? {
        id: profile.id,
        subscription_status: profile.subscription_status,
        daily_video_count: profile.daily_video_count,
      }
    : null;

  return (
    <div className="container py-10">
      <SubscriptionPlans profile={serializedProfile} />
    </div>
  );
}
