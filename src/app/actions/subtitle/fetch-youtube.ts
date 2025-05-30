"use server";

import { z } from "zod";
import fetch from "node-fetch";
import { createSafeActionClient } from "next-safe-action";
import AbortController from "abort-controller";
import { ActionResponse, AppError, AppErrorCode } from "../actions";
import { createLogger } from "@/lib/logger";
import { createServerClient } from "@supabase/ssr";
import { cookies, headers as nextHeaders } from "next/headers";
import type { Database } from "@/types/supabase";

const youtubeSubtitleLogger = createLogger("youtube-subtitle-service");

// Context interface for middleware
interface ActionContext {
  userId?: string;
  ipAddress?: string;
}

// Function to map AppErrorCode to HTTP status codes
function getStatusCodeFromAppError(code: AppErrorCode): number {
  switch (code) {
    case AppErrorCode.INVALID_INPUT:
      return 400;
    case AppErrorCode.CONFIGURATION_ERROR:
      return 500;
    case AppErrorCode.SERVICE_ERROR:
      return 503; // Or specific error from service
    // Add other specific mappings as needed
    default:
      return 500;
  }
}

// Create a new action client with middleware
const youtubeSubtitleAction = createSafeActionClient({
  async middleware(): Promise<ActionContext> {
    const cookieStore = cookies();
    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
        },
      }
    );
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const ip =
      nextHeaders().get("x-forwarded-for") ?? nextHeaders().get("remote_addr");
    return { userId: user?.id, ipAddress: ip ?? undefined };
  },
  handleReturnedServerError(e: Error) {
    let loggedErrorCodeStr: string =
      AppErrorCode[AppErrorCode.UNEXPECTED_ERROR];
    let responseStatusCode: number = 500;
    let originalErrorCode: AppErrorCode = AppErrorCode.UNEXPECTED_ERROR;

    if (e instanceof AppError) {
      loggedErrorCodeStr = AppErrorCode[e.code];
      originalErrorCode = e.code;
      responseStatusCode = getStatusCodeFromAppError(e.code);
    }

    youtubeSubtitleLogger.error("server-error-handler", {
      error_code: loggedErrorCodeStr,
      error_message: e.message,
      stack_trace: e.stack,
      response_status_code: responseStatusCode,
    });
    return {
      serverError: e.message,
      code: originalErrorCode,
    };
  },
});

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

export const fetchYouTubeSubtitles = youtubeSubtitleAction(
  fetchYouTubeSubtitlesSchema,
  async (
    input: FetchYouTubeSubtitlesInput,
    { userId, ipAddress }: ActionContext
  ): Promise<ActionResponse<FetchYouTubeSubtitlesOutput>> => {
    const actionStartTime = Date.now();
    const { youtubeUrl, languageCode } = input;
    const actionName = "fetch-youtube-subtitles";

    youtubeSubtitleLogger.info(actionName, {
      user_id: userId,
      ip_address: ipAddress,
      metadata: {
        custom_message: "Attempting to fetch YouTube subtitles.",
        youtubeUrl,
        languageCode,
      },
    });

    const downloaderServiceUrl = process.env.AUDIO_SEGMENTER_URL;
    if (!downloaderServiceUrl) {
      const configError = new AppError(
        AppErrorCode.CONFIGURATION_ERROR,
        "Subtitle downloader service URL is not configured."
      );
      const durationMs = Date.now() - actionStartTime;
      youtubeSubtitleLogger.error(actionName, {
        user_id: userId,
        ip_address: ipAddress,
        error_code: AppErrorCode[configError.code],
        error_message: configError.message,
        duration_ms: durationMs,
        response_status_code: getStatusCodeFromAppError(configError.code),
      });
      return { success: false, error: configError };
    }

    const endpoint = `${downloaderServiceUrl}/download-srt`;
    youtubeSubtitleLogger.debug(actionName, {
      user_id: userId,
      ip_address: ipAddress,
      metadata: { endpoint, youtubeUrl, languageCode },
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      youtubeSubtitleLogger.warn(actionName, {
        user_id: userId,
        ip_address: ipAddress,
        metadata: {
          custom_message:
            "Subtitle downloader service request timed out (60s).",
          endpoint,
          youtubeUrl,
          languageCode,
        },
      });
      controller.abort();
    }, 60000);

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

      clearTimeout(timeoutId);

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
        const durationMs = Date.now() - actionStartTime;
        youtubeSubtitleLogger.error(actionName, {
          user_id: userId,
          ip_address: ipAddress,
          error_code: AppErrorCode[serviceError.code],
          error_message: serviceError.message,
          response_status_code: response.status,
          metadata: { errorBody, endpoint, youtubeUrl, languageCode },
        });
        return { success: false, error: serviceError };
      }

      const srtContent = await response.text();

      if (typeof srtContent !== "string" || !srtContent.trim()) {
        const contentError = new AppError(
          AppErrorCode.SERVICE_ERROR,
          "Received invalid or empty subtitle content from service."
        );
        throw contentError;
      }
      const durationMs = Date.now() - actionStartTime;
      youtubeSubtitleLogger.info(actionName, {
        user_id: userId,
        ip_address: ipAddress,
        duration_ms: durationMs,
        response_status_code: 200,
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
      const durationMs = Date.now() - actionStartTime;
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
        user_id: userId,
        ip_address: ipAddress,
        error_code: AppErrorCode[appErr.code],
        error_message: appErr.message,
        stack_trace: appErr.stack,
        duration_ms: durationMs,
        response_status_code: getStatusCodeFromAppError(appErr.code),
        metadata: { rawError: String(error), endpoint },
      });

      return {
        success: false,
        error: appErr,
      };
    }
  }
);
