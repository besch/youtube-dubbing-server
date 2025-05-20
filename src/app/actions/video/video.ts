"use server";

import { z } from "zod";
import { createSafeActionClient } from "next-safe-action";
import { ActionResponse, AppError, appErrors, AppErrorCode } from "../actions";
import { extractYoutubeVideoId } from "./utils";

const getVideoByUrlSchema = z.object({
  youtubeUrl: z.string().url("Invalid YouTube URL"),
});

type GetVideoByUrlInput = z.infer<typeof getVideoByUrlSchema>;

interface GetVideoByUrlOutput {
  youtube_id: string;
  title: string;
  thumbnail_url: string | null;
}

export const getVideoByUrl = createSafeActionClient()(
  getVideoByUrlSchema,
  async (
    input: GetVideoByUrlInput
  ): Promise<ActionResponse<GetVideoByUrlOutput | null>> => {
    const { youtubeUrl } = input;
    let youtubeId: string;

    try {
      youtubeId = extractYoutubeVideoId(youtubeUrl);
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, error: error };
      }
      console.error("Unexpected error during YouTube ID extraction:", error);
      return { success: false, error: appErrors.INVALID_INPUT };
    }

    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
        youtubeUrl
      )}&format=json`;
      console.log(`Fetching oEmbed metadata from: ${oembedUrl}`);
      const oembedResponse = await fetch(oembedUrl);

      if (!oembedResponse.ok) {
        console.warn(
          `oEmbed request for ${youtubeId} failed with status ${oembedResponse.status}.`
        );
        return { success: true, data: null };
      }

      const oembedData = await oembedResponse.json();
      return {
        success: true,
        data: {
          youtube_id: youtubeId,
          title: oembedData.title || "Untitled Video",
          thumbnail_url: oembedData.thumbnail_url || null,
        },
      };
    } catch (error) {
      console.error("Error in getVideoByUrl action:", error);
      if (error instanceof AppError) {
        return { success: false, error: error };
      }
      return { success: false, error: appErrors.UNEXPECTED_ERROR };
    }
  }
);
