"use server";

import { z } from "zod";
import { createSafeActionClient } from "next-safe-action";

import { ActionResponse, AppError, AppErrorCode } from "../actions";
import { subtitleService } from "@/lib/subtitles/service";
import { createLogger } from "@/lib/logger";

const subtitleFetchLogger = createLogger("subtitle-fetch-service");

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
    const actionName = "fetch-movie-subtitles";

    subtitleFetchLogger.info(actionName, {
      request_payload: { imdbID, languageCode, seasonNumber, episodeNumber },
      metadata: { custom_message: "Attempting to fetch movie/show subtitles." },
    });

    try {
      const result = await subtitleService.getOrGenerateSubtitles({
        imdbID,
        targetLanguage: languageCode,
        seasonNumber,
        episodeNumber,
      });

      if (!result || typeof result.content !== "string") {
        const invalidDataError = new AppError(
          AppErrorCode.UNEXPECTED_ERROR,
          "Subtitle service returned invalid data."
        );
        subtitleFetchLogger.error(actionName, {
          error_code: AppErrorCode[invalidDataError.code],
          error_message: invalidDataError.message,
          request_payload: {
            imdbID,
            languageCode,
            seasonNumber,
            episodeNumber,
          },
          metadata: { received_result: result as any },
        });
        return {
          success: false,
          error: invalidDataError,
        };
      }

      const { content, generated } = result;

      subtitleFetchLogger.info(actionName, {
        metadata: {
          custom_message: "Successfully fetched/generated subtitles.",
          imdbID,
          languageCode,
          seasonNumber,
          episodeNumber,
          generated,
          srtLength: content.length,
        },
      });

      return {
        success: true,
        data: {
          srtContent: content,
          generated,
        },
      };
    } catch (error: unknown) {
      const appErr =
        error instanceof AppError
          ? error
          : new AppError(
              AppErrorCode.UNEXPECTED_ERROR,
              error instanceof Error
                ? error.message
                : "Failed to fetch subtitles"
            );

      subtitleFetchLogger.error(actionName, {
        error_code: AppErrorCode[appErr.code],
        error_message: appErr.message,
        request_payload: { imdbID, languageCode, seasonNumber, episodeNumber },
        stack_trace: appErr.stack,
        metadata: { rawError: String(error) },
      });

      return {
        success: false,
        error: appErr,
      };
    }
  }
);
