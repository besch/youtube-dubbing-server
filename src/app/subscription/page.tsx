"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SubscriptionStatus } from "@/components/subscription/subscription-status";
import { SubscriptionPlans } from "@/components/subscription/subscription-plans";
import type { Database } from "@/types/supabase";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { Crown } from "lucide-react";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export default function SubscriptionPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    async function loadProfile() {
      setIsLoading(true);
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (user) {
          const { data: profileData } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", user.id)
            .single();

          if (profileData) {
            setProfile(profileData);
          }
        }
      } catch (error) {
        console.error("Error loading profile:", error);
      } finally {
        setIsLoading(false);
      }
    }

    loadProfile();

    const channel = supabase
      .channel("profile_changes")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: profile?.id ? `id=eq.${profile.id}` : undefined,
        },
        (payload: RealtimePostgresChangesPayload<Profile>) => {
          if (
            payload.new &&
            "id" in payload.new &&
            profile &&
            payload.new.id === profile.id
          ) {
            setProfile(payload.new as Profile);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, profile?.id]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-neutral-900 to-black text-white">
        <div className="container mx-auto px-4 py-8">
          <div className="flex flex-col items-center justify-center min-h-[600px]">
            {/* Enhanced Loading State */}
            <div className="relative">
              <div className="w-16 h-16 border-4 border-violet-500/20 border-t-violet-500 rounded-full animate-spin"></div>
              <div className="absolute inset-0 w-16 h-16 border-4 border-purple-500/20 border-r-purple-500 rounded-full animate-spin animate-reverse delay-150"></div>
            </div>
            <p className="mt-6 text-neutral-400 animate-pulse">
              Loading your subscription details...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-900 to-black text-white relative overflow-hidden">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-10 right-20 w-72 h-72 bg-violet-500/5 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute bottom-10 left-20 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl animate-pulse delay-1000"></div>
      </div>

      <div className="container mx-auto px-4 py-12 relative z-10">
        {/* Header Section */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-violet-500/10 border border-violet-500/20 rounded-full px-4 py-2 mb-6">
            <Crown size={16} className="text-violet-400" />
            <span className="text-sm text-violet-300">Choose Your Plan</span>
          </div>

          <h1 className="text-4xl sm:text-5xl font-extrabold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-violet-400 via-purple-500 to-orange-500">
            Subscription Plans
          </h1>

          <p className="text-lg text-neutral-400 max-w-2xl mx-auto mb-8">
            Start free, upgrade when you need more. No commitments, cancel
            anytime.
          </p>
        </div>

        {/* Enhanced Plan Description */}
        <div className="text-center mb-16 max-w-4xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Free Tier Highlight */}
            <div className="bg-gradient-to-br from-neutral-800/40 to-neutral-900/40 p-8 rounded-2xl border border-neutral-700/50">
              <div className="mb-4">
                <span className="bg-gradient-to-r from-violet-500 to-purple-500 text-white px-3 py-1 rounded-full text-sm font-medium">
                  Free Forever
                </span>
              </div>
              <p className="text-2xl sm:text-3xl text-neutral-200 mb-4">
                Watch up to{" "}
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-violet-400 via-purple-500 to-orange-500 font-bold">
                  4 dubbed videos
                </span>{" "}
                daily
              </p>
              <p className="text-neutral-400">
                Perfect for casual viewing with access to YouTube, movies, and
                TV shows
              </p>
            </div>

            {/* Premium Tier Highlight */}
            <div className="bg-gradient-to-br from-violet-500/10 to-purple-500/10 p-8 rounded-2xl border border-violet-500/30 relative overflow-hidden">
              <div className="mb-4">
                <span className="bg-gradient-to-r from-violet-500 to-purple-500 text-white px-3 py-1 rounded-full text-sm font-medium">
                  Premium
                </span>
              </div>
              <p className="text-2xl sm:text-3xl text-neutral-200 mb-4">
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-violet-400 via-purple-500 to-orange-500 font-bold">
                  Unlimited access
                </span>{" "}
                with premium voices
              </p>
              <p className="text-neutral-400">
                Unlimited dubbing, premium AI voices, and priority processing
              </p>
            </div>
          </div>
        </div>

        {/* Plans Component */}
        <div className="max-w-5xl mx-auto">
          {profile && profile.subscription_status === "premium" ? (
            <div className="text-center mb-8">
              <div className="inline-flex items-center gap-2 bg-gradient-to-r from-violet-500/20 to-purple-500/20 border border-violet-500/30 rounded-full px-6 py-3">
                <Crown size={20} className="text-violet-400" />
                <span className="text-violet-300 font-medium">
                  You're on Premium!
                </span>
              </div>
            </div>
          ) : null}

          {profile && profile.subscription_status === "premium" ? (
            <SubscriptionStatus profile={profile} />
          ) : (
            <SubscriptionPlans profile={profile} />
          )}
        </div>
      </div>
    </div>
  );
}
