"use server";

import { z } from "zod";
import { createSafeActionClient } from "next-safe-action";
import { ActionResponse, AppError, appErrors, AppErrorCode } from "../actions";
import { extractYoutubeVideoId } from "./utils";
import { createLogger } from "@/lib/logger";
import { createServerClient } from "@supabase/ssr";
import { cookies, headers as nextHeaders } from "next/headers";
import type { Database } from "@/types/supabase";

const videoActionsLogger = createLogger("video-actions-service");

interface ActionContext {
  userId?: string;
  ipAddress?: string;
}

// Function to map AppErrorCode to HTTP status codes
function getStatusCodeFromAppError(code: AppErrorCode): number {
  switch (code) {
    case AppErrorCode.INVALID_INPUT:
    case AppErrorCode.VALIDATION_ERROR:
      return 400;
    case AppErrorCode.UNAUTHENTICATED:
      return 401;
    case AppErrorCode.UNAUTHORIZED:
    case AppErrorCode.FORBIDDEN:
      return 403;
    case AppErrorCode.RECORD_NOT_FOUND:
    case AppErrorCode.VIDEO_NOT_FOUND:
      return 404;
    default:
      return 500;
  }
}

const videoAction = createSafeActionClient({
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

    videoActionsLogger.error("server-error-handler", {
      error_code: loggedErrorCodeStr,
      error_message: e.message,
      stack_trace: e.stack,
      response_status_code: responseStatusCode,
    });
    // This structure is what next-safe-action will provide in the `serverError` field of the hook's result
    return {
      serverError: e.message,
      code: originalErrorCode,
      // stringCode: loggedErrorCodeStr (optional if needed by client)
    };
  },
});

const getVideoByUrlSchema = z.object({
  youtubeUrl: z.string().url("Invalid YouTube URL"),
});

type GetVideoByUrlInput = z.infer<typeof getVideoByUrlSchema>;

interface GetVideoByUrlOutput {
  youtube_id: string;
  title: string;
  thumbnail_url: string | null;
}

export const getVideoByUrl = videoAction(
  getVideoByUrlSchema,
  async (
    input: GetVideoByUrlInput,
    { userId, ipAddress }: ActionContext
  ): Promise<ActionResponse<GetVideoByUrlOutput | null>> => {
    const startTime = Date.now();
    const { youtubeUrl } = input;
    const actionName = "get-video-by-url";
    let youtubeId: string;

    videoActionsLogger.info(actionName, {
      user_id: userId,
      ip_address: ipAddress,
      request_payload: { youtubeUrl },
      metadata: {
        custom_message: "Attempting to get video by URL via oEmbed.",
      },
    });

    try {
      youtubeId = extractYoutubeVideoId(youtubeUrl);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const appErr =
        error instanceof AppError
          ? error
          : new AppError(
              AppErrorCode.INVALID_INPUT,
              "Invalid YouTube URL provided for ID extraction"
            );
      videoActionsLogger.error(actionName, {
        user_id: userId,
        ip_address: ipAddress,
        error_code: AppErrorCode[appErr.code],
        error_message: appErr.message,
        request_payload: { youtubeUrl },
        stack_trace: appErr.stack,
        duration_ms: durationMs,
        response_status_code: getStatusCodeFromAppError(appErr.code),
        metadata: { rawError: String(error) },
      });
      return { success: false, error: appErr };
    }

    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
        youtubeUrl
      )}&format=json`;
      videoActionsLogger.debug(actionName, {
        user_id: userId,
        ip_address: ipAddress,
        metadata: {
          custom_message: "Fetching oEmbed metadata",
          oembedUrl,
          youtubeId,
        },
      });
      const oembedResponse = await fetch(oembedUrl);

      if (!oembedResponse.ok) {
        const durationMs = Date.now() - startTime;
        videoActionsLogger.warn(actionName, {
          user_id: userId,
          ip_address: ipAddress,
          response_status_code: oembedResponse.status, // Log actual oEmbed status
          duration_ms: durationMs,
          metadata: {
            custom_message:
              "oEmbed request failed, video metadata might not exist or URL is invalid.",
            youtubeId,
            oembedUrl,
            status: oembedResponse.status,
          },
        });
        return { success: true, data: null }; // No statusCode in success data part of ActionResponse
      }

      const oembedData = await oembedResponse.json();
      const durationMs = Date.now() - startTime;
      videoActionsLogger.info(actionName, {
        user_id: userId,
        ip_address: ipAddress,
        duration_ms: durationMs,
        response_status_code: 200, // Overall action success
        metadata: {
          custom_message: "Successfully fetched video metadata via oEmbed.",
          youtubeId,
        },
        response_payload: {
          title: oembedData.title,
          thumbnail_url: oembedData.thumbnail_url,
        },
      });
      return {
        success: true,
        data: {
          youtube_id: youtubeId,
          title: oembedData.title || "Untitled Video",
          thumbnail_url: oembedData.thumbnail_url || null,
        },
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const appErr =
        error instanceof AppError
          ? error
          : new AppError(
              AppErrorCode.UNEXPECTED_ERROR,
              "Error fetching oEmbed data"
            );
      videoActionsLogger.error(actionName, {
        user_id: userId,
        ip_address: ipAddress,
        error_code: AppErrorCode[appErr.code],
        error_message: appErr.message,
        request_payload: { youtubeUrl, youtubeId_extracted: youtubeId },
        stack_trace: appErr.stack,
        duration_ms: durationMs,
        response_status_code: getStatusCodeFromAppError(appErr.code),
        metadata: { rawError: String(error) },
      });
      return { success: false, error: appErr };
    }
  }
);
