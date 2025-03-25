import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { google } from "npm:googleapis";

// Create a YouTube client
const youtube = google.youtube({
  version: "v3",
  auth: Deno.env.get("YOUTUBE_API_KEY"),
});

// Convert ISO 8601 duration format to seconds
function convertISO8601ToSeconds(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;

  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  const seconds = parseInt(match[3] || "0", 10);

  return hours * 3600 + minutes * 60 + seconds;
}

serve(async (req) => {
  try {
    const { query, maxResults = 10 } = await req.json();

    // Search for videos
    const response = await youtube.search.list({
      part: ["snippet"],
      q: query,
      maxResults,
      type: ["video"],
    });

    if (!response.data.items) {
      return new Response(JSON.stringify({ success: true, data: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get video details for each search result to get duration
    const videoIds = response.data.items
      .map((item) => item.id?.videoId)
      .filter(Boolean) as string[];

    if (videoIds.length === 0) {
      return new Response(JSON.stringify({ success: true, data: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const videoDetailsResponse = await youtube.videos.list({
      part: ["contentDetails", "statistics"],
      id: videoIds,
    });

    // Map search results to include details
    const results = response.data.items.map((item) => {
      const videoDetails = videoDetailsResponse.data.items?.find(
        (v) => v.id === item.id?.videoId
      );

      const durationInSeconds = videoDetails?.contentDetails?.duration
        ? convertISO8601ToSeconds(videoDetails.contentDetails.duration)
        : 0;

      return {
        id: item.id?.videoId || "",
        title: item.snippet?.title || "",
        description: item.snippet?.description || "",
        thumbnail_url:
          item.snippet?.thumbnails?.high?.url ||
          item.snippet?.thumbnails?.default?.url ||
          "",
        duration: durationInSeconds,
        views: parseInt(videoDetails?.statistics?.viewCount || "0", 10),
        published_at: item.snippet?.publishedAt || "",
      };
    });

    return new Response(JSON.stringify({ success: true, data: results }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in YouTube search function:", error);

    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: "UNEXPECTED_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "An unexpected error occurred",
        },
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
