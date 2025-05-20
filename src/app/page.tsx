import { Metadata } from "next";
import { createServerClient } from "@/lib/supabase";
import { VideoProcessor } from "@/components/video/video-processor";

export const metadata: Metadata = {
  title: "YouTube Dubbing",
  description: "Watch YouTube videos with AI-generated dubbing",
};

export default async function HomePage() {
  const supabase = createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let profile = null;
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("subscription_status, daily_video_count")
      .eq("id", user.id)
      .single();
    profile = data;
  }

  return (
    <div className="container py-8">
      <VideoProcessor
        subscriptionStatus={profile?.subscription_status || "free"}
        dailyVideoCount={profile?.daily_video_count || 0}
      />
    </div>
  );
}
