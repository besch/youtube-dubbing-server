import { Metadata } from "next";
import { notFound } from "next/navigation";
import { createServerClient } from "@/lib/supabase";
import { VideoPlayer } from "@/components/video/video-player";

interface VideoPageProps {
  params: {
    id: string;
  };
  searchParams: {
    language?: string;
    voice?: string;
  };
}

export const metadata: Metadata = {
  title: "Video Processing - YouTube Dubbing",
  description: "Process and dub YouTube videos with AI",
};

export default async function VideoPage({
  params,
  searchParams,
}: VideoPageProps) {
  const supabase = createServerClient();

  // Get user session
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
    notFound();
  }

  // Get user profile
  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_status")
    .eq("id", session.user.id)
    .single();

  if (!profile) {
    notFound();
  }

  // Get video details
  const { data: video } = await supabase
    .from("processed_videos")
    .select("*")
    .eq("video_id", params.id)
    .eq("user_id", session.user.id)
    .single();

  return (
    <div className="container mx-auto py-8">
      <VideoPlayer
        videoId={params.id}
        language={searchParams.language || "en"}
        voice={searchParams.voice || "en-US-Neural2-A"}
        subscriptionStatus={profile.subscription_status}
        existingVideo={video}
      />
    </div>
  );
}
