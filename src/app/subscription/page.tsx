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

        {/* Floating movie elements */}
        <div className="absolute top-20 left-24 w-28 h-5 bg-gradient-to-r from-violet-500/20 to-violet-500/8 animate-float-fade-1 animate-delay-1 rounded-sm shadow-lg">
          <div className="flex h-full">
            {[...Array(10)].map((_, i) => (
              <div
                key={i}
                className="flex-1 border-r border-violet-400/40 bg-violet-500/12"
              ></div>
            ))}
          </div>
        </div>

        <div className="absolute bottom-32 right-28 w-32 h-6 bg-gradient-to-l from-purple-500/18 to-transparent animate-float-fade-2 animate-delay-3 rounded-sm shadow-md">
          <div className="flex h-full">
            {[...Array(12)].map((_, i) => (
              <div
                key={i}
                className="flex-1 border-r border-purple-400/35 bg-purple-500/10"
              ></div>
            ))}
          </div>
        </div>

        <div className="absolute top-80 left-40 w-20 h-12 bg-gradient-to-br from-orange-500/16 to-violet-500/12 rounded-md animate-float-fade-3 animate-delay-5 border border-orange-400/25 shadow-md">
          <div className="w-full h-full rounded-md bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-0 h-0 border-l-[5px] border-l-white/45 border-t-[3px] border-t-transparent border-b-[3px] border-b-transparent"></div>
        </div>

        <div className="absolute top-44 right-32 w-10 h-10 animate-float-fade-4 animate-delay-2">
          <div className="w-0 h-0 border-l-[15px] border-l-purple-400/60 border-t-[7px] border-t-transparent border-b-[7px] border-b-transparent ml-2 drop-shadow-md"></div>
        </div>

        <div className="absolute bottom-48 left-20 w-3 h-3 bg-violet-400/70 rounded-full animate-float-fade-5 animate-delay-4 shadow-lg shadow-violet-400/40"></div>
        <div className="absolute top-28 right-48 w-2 h-2 bg-orange-400/60 rounded-full animate-float-fade-6 animate-delay-6 shadow-md shadow-orange-400/30"></div>
        <div className="absolute bottom-20 left-60 w-2.5 h-2.5 bg-purple-400/65 rounded-full animate-float-fade-1 animate-delay-1 shadow-md shadow-purple-400/30"></div>
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
