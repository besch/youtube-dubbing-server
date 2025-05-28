"use server";

import { z } from "zod";
import fetch from "node-fetch";
import { createSafeActionClient } from "next-safe-action";
import AbortController from "abort-controller";
import { ActionResponse, AppError, AppErrorCode } from "../actions";

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

    const downloaderServiceUrl = process.env.AUDIO_SEGMENTER_URL;
    if (!downloaderServiceUrl) {
      console.error("AUDIO_SEGMENTER_URL environment variable is not set.");
      return {
        success: false,
        error: new AppError(
          AppErrorCode.CONFIGURATION_ERROR,
          "Subtitle downloader service URL is not configured."
        ),
      };
    }

    const endpoint = `${downloaderServiceUrl}/download-srt`;

    console.log(
      `Fetching YouTube subtitles from ${endpoint} for URL: ${youtubeUrl}, Lang: ${languageCode}`
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.log(`Aborting fetch to ${endpoint} due to 60s timeout.`);
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
        console.error(
          `Failed to fetch YouTube subtitles. Status: ${response.status}. Body: ${errorBody}`
        );
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
        return {
          success: false,
          error: new AppError(AppErrorCode.SERVICE_ERROR, message),
        };
      }

      const srtContent = await response.text();

      if (typeof srtContent !== "string" || !srtContent.trim()) {
        console.error(
          "Invalid or empty SRT content received from subtitle download service.",
          srtContent
        );
        return {
          success: false,
          error: new AppError(
            AppErrorCode.SERVICE_ERROR,
            "Received invalid or empty subtitle content from service."
          ),
        };
      }

      console.log(
        `Successfully fetched YouTube subtitles for ${youtubeUrl}. SRT Length: ${srtContent.length}`
      );
      return { success: true, data: { srtContent } };
    } catch (error: unknown) {
      console.error("Error in fetchYouTubeSubtitles action:", error);
      if (error instanceof AppError) {
        return { success: false, error };
      }

      let errCode = AppErrorCode.UNEXPECTED_ERROR;
      let errMsg =
        "Failed to fetch YouTube subtitles due to an unexpected error.";

      // Check for AbortError (timeout)
      if (error instanceof Error && error.name === "AbortError") {
        errCode = AppErrorCode.SERVICE_ERROR;
        errMsg = `Request to subtitle download service timed out after 60 seconds. Endpoint: ${endpoint}`;
      }
      // Check for network-type errors
      else if (
        error instanceof Error &&
        (error.name === "FetchError" ||
          error.message.includes("ECONNREFUSED") ||
          error.message.includes("network error") ||
          error.message.includes("Failed to fetch"))
      ) {
        errCode = AppErrorCode.SERVICE_ERROR; // Use SERVICE_ERROR for network issues with the subtitle service
        errMsg =
          "Could not connect to the subtitle download service. Please check if the service is running and accessible.";
      }

      return {
        success: false,
        error: new AppError(
          errCode,
          error instanceof Error
            ? `${errMsg} Details: ${error.message}`
            : errMsg
        ),
      };
    }
  }
);
