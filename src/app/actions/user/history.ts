"use server";

import { z } from "zod";
import type { Tables } from "@/types/supabase";
import { protectedAction } from "../safe-action";
import { supabaseServiceRoleClient } from "@/lib/supabase/serviceRoleClient";
import { ActionResponse, AppError, AppErrorCode, appErrors } from "../actions";

// --- Action: Update History --- //
const updateHistorySchema = z.object({
  dbVideoId: z.string().uuid(),
  position: z.number().min(0),
});

export const updateHistory = protectedAction
  .schema(updateHistorySchema)
  .action(async ({ parsedInput, ctx }): Promise<ActionResponse<null>> => {
    const userId = ctx.user.id;
    const { dbVideoId, position } = parsedInput;

    try {
      const { error } = await supabaseServiceRoleClient.from("history").upsert(
        {
          user_id: userId,
          video_id: dbVideoId,
          last_position: position,
          watched_at: new Date().toISOString(),
        },
        {
          onConflict: "user_id, video_id",
        }
      );

      if (error) {
        console.error(
          `Error upserting watch history for user ${userId}, video ${dbVideoId}:`,
          error
        );
        throw appErrors.DATABASE_ERROR;
      }

      console.log(
        `Updated history for user ${userId}, video ${dbVideoId} to position ${position}`
      );
      return { success: true, data: null };
    } catch (error) {
      console.error("Error in updateHistory action:", error);
      throw error; // Let handleServerError manage it
    }
  });

// --- Action: Get History ---

const HistoryItemSchema = z.object({
  historyId: z.string().uuid(),
  videoId: z.string().uuid(), // DB video ID
  youtubeId: z.string(),
  title: z.string().nullable(),
  thumbnailUrl: z.string().url().nullable(),
  duration: z.number().int().positive().nullable(),
  lastPosition: z.number().min(0),
  watchedAt: z.string().datetime(),
});
export type HistoryItem = z.infer<typeof HistoryItemSchema>;

export const getHistory = protectedAction
  // No input schema needed
  .action(async ({ ctx }): Promise<ActionResponse<HistoryItem[]>> => {
    const userId = ctx.user.id;
    const supabase = supabaseServiceRoleClient;

    console.log(`Fetching history for user: ${userId}`);

    try {
      const { data, error } = await supabase
        .from("history")
        .select(
          `
          id,
          watched_at,
          last_position,
          video_id,
          videos ( youtube_id, title, thumbnail_url, duration )
        `
        )
        .eq("user_id", userId)
        .order("watched_at", { ascending: false })
        .limit(50); // Limit history items for performance

      if (error) {
        console.error(`DB error fetching history for user ${userId}:`, error);
        throw appErrors.DATABASE_ERROR;
      }

      if (!data) {
        return { success: true, data: [] };
      }

      // Transform data
      const mappedData = data
        .map((item) => {
          const video = item.videos as Tables<"videos"> | null;
          if (!video || !item.watched_at) {
            console.warn(
              `Skipping history ${item.id} due to missing video or watched_at data.`
            );
            return null; // Skip if essential data is missing
          }

          return {
            historyId: item.id,
            videoId: item.video_id,
            youtubeId: video.youtube_id,
            title: video.title ?? null,
            thumbnailUrl: video.thumbnail_url ?? null,
            duration: video.duration ?? null,
            lastPosition: item.last_position,
            watchedAt: new Date(item.watched_at).toISOString(),
          };
        })
        .filter((item) => item !== null);

      const validation = z.array(HistoryItemSchema).safeParse(mappedData);
      if (!validation.success) {
        console.error(
          "History data validation failed:",
          validation.error.errors
        );
        throw new AppError(
          AppErrorCode.UNEXPECTED_ERROR,
          "Failed to validate history data structure."
        );
      }

      console.log(
        `Found ${validation.data.length} history items for user ${userId}`
      );
      return { success: true, data: validation.data };
    } catch (error: unknown) {
      console.error(`Error in getHistory action for user ${userId}:`, error);
      const appErr =
        error instanceof AppError ? error : appErrors.UNEXPECTED_ERROR;
      return { success: false, error: appErr };
    }
  });
