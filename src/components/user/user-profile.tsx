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
    <div className="container max-w-4xl py-8">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            Manage your account settings and subscription
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <h3 className="text-lg font-medium">Account Information</h3>
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <span className="font-medium">Email:</span>
                <span>{profile.email}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium">Name:</span>
                <span>{profile.display_name || "Not set"}</span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-medium">Subscription</h3>
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <span className="font-medium">Status:</span>
                <span className="capitalize">
                  {profile.subscription_status}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-medium">Usage</h3>
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <span className="font-medium">Daily videos:</span>
                <span>
                  {profile.daily_video_count}/4
                  {profile.subscription_status === "premium" && " (unlimited)"}
                </span>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={handleSignOut}
              disabled={isLoading}
            >
              {isLoading && (
                <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
              )}
              Sign Out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
