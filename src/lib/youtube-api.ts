import { google } from "googleapis";
import { YoutubeVideoInfo } from "@/types";
import { appErrors } from "@/app/actions/actions";

const youtube = google.youtube({
  version: "v3",
  auth: process.env.YOUTUBE_API_KEY,
});

/**
 * Get video details from YouTube Data API
 */
export async function getVideoDetails(
  videoId: string
): Promise<YoutubeVideoInfo> {
  try {
    const response = await youtube.videos.list({
      part: ["snippet", "contentDetails"],
      id: [videoId],
    });

    if (!response.data.items || response.data.items.length === 0) {
      throw appErrors.VIDEO_NOT_FOUND;
    }

    const video = response.data.items[0];
    const snippet = video.snippet!;
    const contentDetails = video.contentDetails!;

    // Convert ISO 8601 duration to seconds
    const durationStr = contentDetails.duration!;
    const durationInSeconds = convertISO8601ToSeconds(durationStr);

    return {
      id: videoId,
      title: snippet.title || "Unknown title",
      description: snippet.description || "",
      thumbnail_url:
        snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url || "",
      duration: durationInSeconds,
    };
  } catch (error) {
    console.error("Error fetching video details:", error);
    if (error === appErrors.VIDEO_NOT_FOUND) {
      throw error;
    }
    throw appErrors.UNEXPECTED_ERROR;
  }
}

/**
 * Search for YouTube videos
 */
export async function searchYoutubeVideos(query: string, maxResults = 10) {
  try {
    const response = await youtube.search.list({
      part: ["snippet"],
      q: query,
      maxResults,
      type: ["video"],
    });

    if (!response.data.items) {
      return [];
    }

    // Get video details for each search result to get duration
    const videoIds = response.data.items
      .map((item) => item.id?.videoId)
      .filter(Boolean) as string[];

    if (videoIds.length === 0) {
      return [];
    }

    const videoDetailsResponse = await youtube.videos.list({
      part: ["contentDetails", "statistics"],
      id: videoIds,
    });

    // Map search results to include details
    return response.data.items.map((item) => {
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
  } catch (error) {
    console.error("Error searching YouTube videos:", error);
    throw appErrors.UNEXPECTED_ERROR;
  }
}

/**
 * Convert ISO 8601 duration format to seconds
 * Example: PT1H30M15S -> 5415 seconds (1h 30m 15s)
 */
function convertISO8601ToSeconds(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;

  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  const seconds = parseInt(match[3] || "0", 10);

  return hours * 3600 + minutes * 60 + seconds;
}
