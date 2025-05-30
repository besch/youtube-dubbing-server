"use server";

import { z } from "zod";
import { createSafeActionClient } from "next-safe-action";
import { ActionResponse, AppError, appErrors, AppErrorCode } from "../actions";
import { extractYoutubeVideoId } from "./utils";
import { createLogger } from "@/lib/logger";

const videoActionsLogger = createLogger("video-actions-service");

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
    const actionName = "get-video-by-url";
    let youtubeId: string;

    videoActionsLogger.info(actionName, {
      request_payload: { youtubeUrl },
      metadata: {
        custom_message: "Attempting to get video by URL via oEmbed.",
      },
    });

    try {
      youtubeId = extractYoutubeVideoId(youtubeUrl);
    } catch (error) {
      const appErr =
        error instanceof AppError
          ? error
          : new AppError(
              AppErrorCode.INVALID_INPUT,
              "Invalid YouTube URL provided for ID extraction"
            );
      videoActionsLogger.error(actionName, {
        error_code: AppErrorCode[appErr.code],
        error_message: appErr.message,
        request_payload: { youtubeUrl },
        stack_trace: appErr.stack,
        metadata: { rawError: String(error) },
      });
      return { success: false, error: appErr };
    }

    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
        youtubeUrl
      )}&format=json`;
      videoActionsLogger.debug(actionName, {
        metadata: {
          custom_message: "Fetching oEmbed metadata",
          oembedUrl,
          youtubeId,
        },
      });
      const oembedResponse = await fetch(oembedUrl);

      if (!oembedResponse.ok) {
        videoActionsLogger.warn(actionName, {
          response_status_code: oembedResponse.status,
          metadata: {
            custom_message:
              "oEmbed request failed, video metadata might not exist or URL is invalid.",
            youtubeId,
            oembedUrl,
            status: oembedResponse.status,
          },
        });
        return { success: true, data: null };
      }

      const oembedData = await oembedResponse.json();
      videoActionsLogger.info(actionName, {
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
      const appErr =
        error instanceof AppError
          ? error
          : new AppError(
              AppErrorCode.UNEXPECTED_ERROR,
              "Error fetching oEmbed data"
            );
      videoActionsLogger.error(actionName, {
        error_code: AppErrorCode[appErr.code],
        error_message: appErr.message,
        request_payload: { youtubeUrl, youtubeId_extracted: youtubeId },
        stack_trace: appErr.stack,
        metadata: { rawError: String(error) },
      });
      return { success: false, error: appErr };
    }
  }
);
