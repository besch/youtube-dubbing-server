"use server";

import { createSafeActionClient } from "next-safe-action";
import { z } from "zod";
import type { ActionResponse } from "@/types/actions";
import { appErrors } from "@/types/actions";
import { searchYoutubeVideos } from "@/lib/youtube-api";

const action = createSafeActionClient();

// Schema for YouTube search
const searchSchema = z.object({
  query: z.string().min(1),
  maxResults: z.number().min(1).max(50).optional(),
});

export const searchYoutube = action
  .schema(searchSchema)
  .action(async ({ parsedInput }) => {
    const { query, maxResults = 10 } = parsedInput;

    try {
      const results = await searchYoutubeVideos(query, maxResults);

      return {
        success: true,
        data: results,
      };
    } catch (error) {
      console.error("Error searching YouTube:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? {
                code: "UNEXPECTED_ERROR",
                message: error.message,
              }
            : appErrors.UNEXPECTED_ERROR,
      };
    }
  });
