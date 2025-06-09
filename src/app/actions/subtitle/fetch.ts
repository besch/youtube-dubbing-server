"use server";

import { z } from "zod";
import { createSafeActionClient } from "next-safe-action";
import { ActionResponse, AppError, AppErrorCode } from "../actions";
import { subtitleService } from "@/lib/subtitles/service";
import { createLogger } from "@/lib/logger";
import { createServerClient } from "@supabase/ssr";
import { cookies, headers as nextHeaders } from "next/headers";
import type { Database } from "@/types/supabase";

const subtitleFetchLogger = createLogger("subtitle-fetch-service");

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
    // Add other specific mappings as needed
    default:
      return 500;
  }
}

// Create a new action client with middleware
const subtitleAction = createSafeActionClient({
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

    subtitleFetchLogger.error("server-error-handler", {
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

const fetchSubtitlesSchema = z.object({
  imdbID: z.string().min(1, { message: "IMDb ID cannot be empty" }),
  title: z.string().min(1, { message: "Movie title cannot be empty" }),
  year: z.string().optional(),
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

export const fetchSubtitles = subtitleAction(
  fetchSubtitlesSchema,
  async (
    input: FetchSubtitlesInput,
    { userId, ipAddress }: ActionContext
  ): Promise<ActionResponse<FetchSubtitlesOutput>> => {
    const actionStartTime = Date.now();
    const { imdbID, title, year, languageCode, seasonNumber, episodeNumber } =
      input;
    const actionName = "fetch-movie-subtitles";

    subtitleFetchLogger.info(actionName, {
      user_id: userId,
      ip_address: ipAddress,
      request_payload: {
        imdbID,
        title,
        year,
        languageCode,
        seasonNumber,
        episodeNumber,
      },
      metadata: {
        custom_message: "Attempting to fetch movie/show subtitles.",
      },
    });

    try {
      const result = await subtitleService.getOrGenerateSubtitles({
        imdbID,
        title,
        year,
        targetLanguage: languageCode,
        seasonNumber,
        episodeNumber,
      });

      if (!result || typeof result.content !== "string") {
        const invalidDataError = new AppError(
          AppErrorCode.UNEXPECTED_ERROR,
          "Subtitle service returned invalid data."
        );
        // This error is critical for the action's success, let outer catch handle
        throw invalidDataError;
      }

      const { content, generated } = result;
      const durationMs = Date.now() - actionStartTime;
      subtitleFetchLogger.info(actionName, {
        user_id: userId,
        ip_address: ipAddress,
        request_payload: {
          imdbID,
          title,
          year,
          languageCode,
          seasonNumber,
          episodeNumber,
        },
        duration_ms: durationMs,
        response_status_code: 200,
        metadata: {
          custom_message: "Successfully fetched/generated subtitles.",
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
      const durationMs = Date.now() - actionStartTime;
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
        user_id: userId,
        ip_address: ipAddress,
        request_payload: {
          imdbID,
          title,
          year,
          languageCode,
          seasonNumber,
          episodeNumber,
        },
        error_code: AppErrorCode[appErr.code],
        error_message: appErr.message,
        stack_trace: appErr.stack,
        duration_ms: durationMs,
        response_status_code: getStatusCodeFromAppError(appErr.code),
        metadata: { rawError: String(error) },
      });
      return {
        success: false,
        error: appErr,
      };
    }
  }
);
