"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Icons } from "@/components/icons";
import { toast } from "sonner";
import type { Database } from "@/types/supabase";

type Profile = {
  id: string;
  email: string;
  display_name: string | null;
  subscription_status: string | null;
  daily_video_count: number | null;
};

interface UserProfileProps {
  profile: Profile;
}

export function UserProfile({ profile }: UserProfileProps) {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const handleSignOut = async () => {
    try {
      setIsLoading(true);
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      router.push("/login");
      router.refresh();
    } catch (error) {
      toast.error("Failed to sign out");
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container max-w-4xl py-12">
      <Card className="bg-neutral-900 border-neutral-700 shadow-xl rounded-xl">
        <CardHeader className="p-6 border-b border-neutral-800">
          <CardTitle className="text-3xl font-bold text-violet-400">
            Profile
          </CardTitle>
          <CardDescription className="text-neutral-400 mt-1">
            Manage your account settings and subscription
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6 space-y-8">
          <div className="space-y-4">
            <h3 className="text-xl font-semibold text-neutral-200">
              Account Information
            </h3>
            <div className="grid gap-3 text-lg">
              <div className="flex items-center gap-3">
                <span className="font-medium text-neutral-400 w-32">
                  Email:
                </span>
                <span className="text-neutral-300">{profile.email}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-medium text-neutral-400 w-32">Name:</span>
                <span className="text-neutral-300">
                  {profile.display_name || "Not set"}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-xl font-semibold text-neutral-200">
              Subscription
            </h3>
            <div className="grid gap-3 text-lg">
              <div className="flex items-center gap-3">
                <span className="font-medium text-neutral-400 w-32">
                  Status:
                </span>
                <span
                  className={`capitalize px-3 py-1 text-sm font-semibold rounded-full ${
                    profile.subscription_status === "active" ||
                    profile.subscription_status === "premium"
                      ? "bg-green-500/20 text-green-400 border-green-500/50"
                      : "bg-yellow-500/20 text-yellow-400 border-yellow-500/50"
                  }`}
                >
                  {profile.subscription_status || "N/A"}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-xl font-semibold text-neutral-200">Usage</h3>
            <div className="grid gap-3 text-lg">
              <div className="flex items-center gap-3">
                <span className="font-medium text-neutral-400 w-32">
                  Daily videos:
                </span>
                <span className="text-neutral-300">
                  {profile.daily_video_count ?? 0}/4
                  {(profile.subscription_status === "active" ||
                    profile.subscription_status === "premium") &&
                    " (Unlimited)"}
                </span>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-6 border-t border-neutral-800">
            <Button
              variant="outline"
              onClick={handleSignOut}
              disabled={isLoading}
              className="bg-transparent hover:bg-red-600/20 text-red-400 hover:text-red-300 border-red-500/50 hover:border-red-500 font-semibold py-2 px-4 rounded-lg transition-colors duration-300 text-lg"
            >
              {isLoading && (
                <Icons.spinner className="mr-2 h-5 w-5 animate-spin" />
              )}
              Sign Out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
