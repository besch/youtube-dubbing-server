"use server";

import { z } from "zod";
import { createSafeActionClient } from "next-safe-action";

import { ActionResponse, AppError, AppErrorCode } from "../actions";
import { subtitleService } from "@/lib/subtitles/service";

const fetchSubtitlesSchema = z.object({
  imdbID: z.string().min(1, { message: "IMDb ID cannot be empty" }),
  languageCode: z
    .string()
    .length(2, { message: "Language code must be 2 characters" }),
  seasonNumber: z.number().int().min(1).optional(),
  episodeNumber: z.number().int().min(1).optional(),
});

type FetchSubtitlesInput = z.infer<typeof fetchSubtitlesSchema>;

export interface FetchSubtitlesOutput {
  srtContent: string;
  generated: boolean;
}

// Create the safe action
export const fetchSubtitles = createSafeActionClient()(
  fetchSubtitlesSchema,
  async (
    input: FetchSubtitlesInput
  ): Promise<ActionResponse<FetchSubtitlesOutput>> => {
    const { imdbID, languageCode, seasonNumber, episodeNumber } = input;

    console.log(
      `[FetchSubtitles] Starting request - IMDb: ${imdbID}, Lang: ${languageCode}, S: ${seasonNumber}, E: ${episodeNumber}`
    );

    try {
      const result = await subtitleService.getOrGenerateSubtitles({
        imdbID,
        targetLanguage: languageCode,
        seasonNumber,
        episodeNumber,
      });

      if (!result || typeof result.content !== "string") {
        console.error(`[FetchSubtitles] Invalid result for ${imdbID}:`, result);
        return {
          success: false,
          error: new AppError(
            AppErrorCode.UNEXPECTED_ERROR,
            "Subtitle service returned invalid data."
          ),
        };
      }

      const { content, generated } = result;

      console.log(
        `[FetchSubtitles] Success for ${imdbID} - Generated: ${generated}, Length: ${content.length} chars`
      );

      return {
        success: true,
        data: {
          srtContent: content,
          generated,
        },
      };
    } catch (error: unknown) {
      console.error(`[FetchSubtitles] Error for ${imdbID}:`, error);

      if (error instanceof AppError) {
        return { success: false, error };
      }

      return {
        success: false,
        error: new AppError(
          AppErrorCode.UNEXPECTED_ERROR,
          error instanceof Error ? error.message : "Failed to fetch subtitles"
        ),
      };
    }
  }
);
