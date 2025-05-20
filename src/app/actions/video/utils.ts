import type { ReplicateSegmentOutput } from "@/lib/replicate";
import { AppError, AppErrorCode } from "../actions";

// Helper to extract YouTube Video ID - throws error if not found
export function extractYoutubeVideoId(url: string): string {
  try {
    const parsedUrl = new URL(url);
    let videoId: string | null = null;

    if (parsedUrl.hostname === "youtu.be") {
      videoId = parsedUrl.pathname.slice(1);
    }
    if (
      parsedUrl.hostname === "www.youtube.com" ||
      parsedUrl.hostname === "youtube.com"
    ) {
      if (parsedUrl.pathname === "/watch") {
        videoId = parsedUrl.searchParams.get("v");
      }
      if (parsedUrl.pathname.startsWith("/embed/")) {
        videoId = parsedUrl.pathname.split("/")[2];
      }
      if (parsedUrl.pathname.startsWith("/shorts/")) {
        videoId = parsedUrl.pathname.split("/shorts/")[1];
      }
    }

    if (videoId) {
      // Basic check for valid characters and length
      if (/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        return videoId;
      } else {
        console.warn("Extracted potential ID, but failed validation:", videoId);
      }
    }
  } catch (error) {
    console.error("Error parsing YouTube URL:", error);
    throw new AppError(
      AppErrorCode.INVALID_INPUT,
      "Could not parse the provided YouTube URL."
    );
  }
  // If no valid ID found after checks
  throw new AppError(
    AppErrorCode.INVALID_INPUT,
    "Could not extract a valid YouTube video ID from the URL."
  );
}
