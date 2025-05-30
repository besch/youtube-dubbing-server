"use server";

import { z } from "zod";
import fetch from "node-fetch";
import { createSafeActionClient } from "next-safe-action";
import AbortController from "abort-controller";
import { ActionResponse, AppError, AppErrorCode } from "../actions";
import { createLogger } from "@/lib/logger";

const youtubeSubtitleLogger = createLogger("youtube-subtitle-service");

// Define the schema for input validation using Zod
const fetchYouTubeSubtitlesSchema = z.object({
  youtubeUrl: z.string().url({ message: "Invalid YouTube URL" }),
  languageCode: z
    .string()
    .min(2, { message: "Language code must be at least 2 characters" }),
});

type FetchYouTubeSubtitlesInput = z.infer<typeof fetchYouTubeSubtitlesSchema>;

export interface FetchYouTubeSubtitlesOutput {
  srtContent: string;
}

// Create the safe action
export const fetchYouTubeSubtitles = createSafeActionClient()(
  fetchYouTubeSubtitlesSchema,
  async (
    input: FetchYouTubeSubtitlesInput
  ): Promise<ActionResponse<FetchYouTubeSubtitlesOutput>> => {
    const { youtubeUrl, languageCode } = input;
    const actionName = "fetch-youtube-subtitles";

    youtubeSubtitleLogger.info(actionName, {
      request_payload: { youtubeUrl, languageCode },
      metadata: { custom_message: "Attempting to fetch YouTube subtitles." },
    });

    const downloaderServiceUrl = process.env.AUDIO_SEGMENTER_URL;
    if (!downloaderServiceUrl) {
      const configError = new AppError(
        AppErrorCode.CONFIGURATION_ERROR,
        "Subtitle downloader service URL is not configured."
      );
      youtubeSubtitleLogger.error(actionName, {
        error_code: AppErrorCode[configError.code],
        error_message: configError.message,
        request_payload: { youtubeUrl, languageCode },
      });
      return {
        success: false,
        error: configError,
      };
    }

    const endpoint = `${downloaderServiceUrl}/download-srt`;

    youtubeSubtitleLogger.debug(actionName, {
      metadata: {
        custom_message: "Calling subtitle downloader service.",
        endpoint,
        youtubeUrl,
        languageCode,
      },
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      youtubeSubtitleLogger.warn(actionName, {
        metadata: {
          custom_message:
            "Subtitle downloader service request timed out (60s).",
          endpoint,
          youtubeUrl,
          languageCode,
        },
      });
      controller.abort();
    }, 60000); // 60 seconds timeout

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          youtube_url: youtubeUrl,
          language_code: languageCode,
        }),
        signal: controller.signal as any,
      });

      clearTimeout(timeoutId); // Clear the timeout if fetch completes or fails before timeout

      if (!response.ok) {
        const errorBody = await response.text();
        let message = `Subtitle download service request failed with status ${response.status}`;
        if (
          response.status === 404 &&
          errorBody.includes("No suitable source subtitles")
        ) {
          message = "No subtitles found for the selected language on YouTube.";
        } else if (response.status === 404) {
          message =
            "Subtitle download endpoint not found or video has no subtitles.";
        }
        const serviceError = new AppError(AppErrorCode.SERVICE_ERROR, message);
        youtubeSubtitleLogger.error(actionName, {
          error_code: AppErrorCode[serviceError.code],
          error_message: serviceError.message,
          response_status_code: response.status,
          metadata: { errorBody, endpoint, youtubeUrl, languageCode },
        });
        return {
          success: false,
          error: serviceError,
        };
      }

      const srtContent = await response.text();

      if (typeof srtContent !== "string" || !srtContent.trim()) {
        const contentError = new AppError(
          AppErrorCode.SERVICE_ERROR,
          "Received invalid or empty subtitle content from service."
        );
        youtubeSubtitleLogger.error(actionName, {
          error_code: AppErrorCode[contentError.code],
          error_message: contentError.message,
          metadata: {
            youtubeUrl,
            languageCode,
            receivedSrtSnippet: srtContent.substring(0, 100),
          },
        });
        return {
          success: false,
          error: contentError,
        };
      }

      youtubeSubtitleLogger.info(actionName, {
        metadata: {
          custom_message: "Successfully fetched YouTube subtitles.",
          youtubeUrl,
          languageCode,
          srtLength: srtContent.length,
        },
      });
      return { success: true, data: { srtContent } };
    } catch (error: unknown) {
      clearTimeout(timeoutId);

      let appErr: AppError;
      if (error instanceof AppError) {
        appErr = error;
      } else {
        let errCode = AppErrorCode.UNEXPECTED_ERROR;
        let errMsg =
          "Failed to fetch YouTube subtitles due to an unexpected error.";

        if (error instanceof Error && error.name === "AbortError") {
          errCode = AppErrorCode.SERVICE_ERROR;
          errMsg = `Request to subtitle download service timed out after 60 seconds. Endpoint: ${endpoint}`;
        } else if (
          error instanceof Error &&
          (error.name === "FetchError" ||
            error.message.includes("ECONNREFUSED") ||
            error.message.includes("network error") ||
            error.message.includes("Failed to fetch"))
        ) {
          errCode = AppErrorCode.SERVICE_ERROR;
          errMsg =
            "Could not connect to the subtitle download service. Please check if the service is running and accessible.";
        }
        appErr = new AppError(
          errCode,
          error instanceof Error
            ? `${errMsg} Details: ${error.message}`
            : errMsg
        );
      }

      youtubeSubtitleLogger.error(actionName, {
        error_code: AppErrorCode[appErr.code],
        error_message: appErr.message,
        request_payload: { youtubeUrl, languageCode },
        stack_trace: appErr.stack,
        metadata: { rawError: String(error), endpoint },
      });

      return {
        success: false,
        error: appErr,
      };
    }
  }
);
