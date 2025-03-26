import { NextResponse } from "next/server";
import { createAdminClient, createServerClient } from "@/lib/supabase";
import { extractYoutubeId, isValidYoutubeUrl } from "@/lib/youtube";
import { getVideoDetails } from "@/lib/youtube-api";
import { extractYoutubeAudio } from "@/lib/aws-services";

export async function POST(request: Request) {
  try {
    // Create supabase clients
    const supabase = createServerClient();
    const adminClient = createAdminClient();

    // Check if user is authenticated (but don't require it)
    const { data: session } = await supabase.auth.getSession();
    const userId = session?.session?.user.id;

    // Parse request body
    const { url, language, voice } = await request.json();

    // Validate input
    if (!url || !language || !voice) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_REQUEST",
            message: "URL, language, and voice parameters are required",
          },
        },
        { status: 400 }
      );
    }

    // Check if the URL is valid
    if (!isValidYoutubeUrl(url)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_YOUTUBE_URL",
            message: "The provided URL is not a valid YouTube URL",
          },
        },
        { status: 400 }
      );
    }

    // Extract the video ID
    const videoId = extractYoutubeId(url);
    if (!videoId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_YOUTUBE_URL",
            message: "Could not extract video ID from URL",
          },
        },
        { status: 400 }
      );
    }

    // Get or create video info
    const { data: existingVideo } = await adminClient
      .from("videos")
      .select("*")
      .eq("youtube_id", videoId)
      .single();

    let dbVideoId: string;

    if (existingVideo) {
      dbVideoId = existingVideo.id;
    } else {
      // Get video info from YouTube API
      const videoInfo = await getVideoDetails(videoId);

      // Start AWS Lambda to extract audio in the background
      extractYoutubeAudio(`https://www.youtube.com/watch?v=${videoId}`, videoId)
        .then((result) => {
          console.log("Audio extraction initiated:", result);
        })
        .catch((error) => {
          console.error("Audio extraction error:", error);
        });

      // Insert into the database
      const { data: newVideo, error } = await adminClient
        .from("videos")
        .insert({
          youtube_id: videoId,
          title: videoInfo.title,
          description: videoInfo.description,
          thumbnail_url: videoInfo.thumbnail_url,
          duration: videoInfo.duration,
        })
        .select()
        .single();

      if (error || !newVideo) {
        console.error("Error inserting video:", error);
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "DATABASE_ERROR",
              message: "Failed to save video information",
            },
          },
          { status: 500 }
        );
      }

      dbVideoId = newVideo.id;
    }

    // Add to user's history if authenticated
    if (userId) {
      await adminClient.from("history").upsert({
        user_id: userId,
        video_id: dbVideoId,
        language,
        voice,
        watched_at: new Date().toISOString(),
        last_position: 0,
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        videoId,
        dbVideoId,
      },
    });
  } catch (error) {
    console.error("Error processing YouTube URL:", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "UNEXPECTED_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "An unexpected error occurred",
        },
      },
      { status: 500 }
    );
  }
}
