"use server";

import { createSafeActionClient } from "next-safe-action";
import { z } from "zod";
import { searchYoutubeVideos } from "@/lib/youtube-api";
import type { ActionResponse } from "@/types/actions"; // Assuming ActionResponse is defined in @/types/actions
import type { YoutubeSearchResponse } from "@/lib/youtube-api";

const searchSchema = z.object({
  query: z.string().min(1),
  maxResults: z.number().min(1).max(50).optional(),
});

export const searchYoutube = createSafeActionClient()(
  searchSchema,
  async (parsedInput): Promise<ActionResponse<YoutubeSearchResponse>> => {
    const { query, maxResults = 10 } = parsedInput;

    try {
      const results = await searchYoutubeVideos(query, maxResults);

      return {
        success: true,
        data: results,
      };
    } catch (error) {
      console.error("Error searching YouTube:", error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : "An unknown error occurred during YouTube search.";
      return {
        success: false,
        error: {
          code:
            error instanceof Error &&
            (error as any).code === "YOUTUBE_API_ERROR"
              ? "YOUTUBE_API_ERROR"
              : "UNEXPECTED_ERROR",
          message: errorMessage,
        },
      };
    }
  }
);
