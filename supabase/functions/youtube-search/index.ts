import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { google } from "npm:googleapis";
// Create a YouTube client
const youtube = google.youtube({
  version: "v3",
  auth: Deno.env.get("YOUTUBE_API_KEY")
});
// Convert ISO 8601 duration format to seconds
function convertISO8601ToSeconds(duration) {
  if (!duration) return 0;
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  const seconds = parseInt(match[3] || "0", 10);
  return hours * 3600 + minutes * 60 + seconds;
}
serve(async (req)=>{
  // Removed OPTIONS check
  try {
    // Get query and optional pageToken from request body
    const { query, maxResults = 10, pageToken } = await req.json();
    if (!query) {
      return new Response(JSON.stringify({
        success: false,
        error: {
          message: "Missing query parameter"
        }
      }), // Removed corsHeaders
      {
        status: 400,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
    // Search for videos
    const response = await youtube.search.list({
      part: [
        "snippet"
      ],
      q: query,
      maxResults,
      type: [
        "video"
      ],
      pageToken
    });
    // Extract nextPageToken from the response
    const nextPageToken = response.data.nextPageToken || undefined;
    if (!response.data.items || response.data.items.length === 0) {
      // Return empty results and potentially a token if the API provided one
      const dataPayload = {
        results: [],
        nextPageToken
      };
      return new Response(JSON.stringify({
        success: true,
        data: dataPayload
      }), // Removed corsHeaders
      {
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
    // Get video details for each search result to get duration and view count
    const videoIds = response.data.items.map((item)=>item.id?.videoId).filter((id)=>Boolean(id));
    let videoDetailsMap = new Map();
    if (videoIds.length > 0) {
      const videoDetailsResponse = await youtube.videos.list({
        part: [
          "contentDetails",
          "statistics"
        ],
        id: videoIds
      });
      if (videoDetailsResponse.data.items) {
        videoDetailsResponse.data.items.forEach((item)=>{
          if (item.id) {
            videoDetailsMap.set(item.id, item);
          }
        });
      }
    }
    // Map search results to include details
    const results = response.data.items.map((item)=>{
      const videoId = item.id?.videoId || "";
      const videoDetails = videoDetailsMap.get(videoId);
      const durationInSeconds = videoDetails?.contentDetails?.duration ? convertISO8601ToSeconds(videoDetails.contentDetails.duration) : 0;
      return {
        id: videoId,
        title: item.snippet?.title || "",
        description: item.snippet?.description || "",
        thumbnail_url: item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.default?.url || "",
        duration: durationInSeconds,
        views: parseInt(videoDetails?.statistics?.viewCount || "0", 10),
        published_at: item.snippet?.publishedAt || ""
      };
    });
    // Structure the successful response payload
    const dataPayload = {
      results,
      nextPageToken
    };
    return new Response(JSON.stringify({
      success: true,
      data: dataPayload
    }), // Removed corsHeaders
    {
      headers: {
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("Error in YouTube search function:", error);
    // Improved error handling
    const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred";
    const errorCode = error?.code || "UNEXPECTED_ERROR"; // Use error code if available
    return new Response(JSON.stringify({
      success: false,
      error: {
        code: errorCode,
        message: errorMessage
      }
    }), // Removed corsHeaders
    {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
});
