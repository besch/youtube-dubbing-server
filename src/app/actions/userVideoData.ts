"use server";

import { z } from "zod";
import { protectedAction } from "./safe-action";
import { createSupabaseServerClient } from "@/lib/supabase/serverClient"; // For user-context RLS
import { appErrors, AppError, ActionResponse } from "./actions";
import type { User } from "@supabase/supabase-js";

// --- Get Favorite Status --- //

const getFavoriteStatusSchema = z.object({
  videoId: z.string().uuid(), // Changed from dbVideoId based on mobile type update
  language: z.string(),
  voice: z.string(),
});

interface GetFavoriteStatusOutput {
  isFavorite: boolean;
}

export const getFavoriteStatus = protectedAction
  .schema(getFavoriteStatusSchema)
  .action(
    async ({
      parsedInput,
      ctx,
    }): Promise<ActionResponse<GetFavoriteStatusOutput>> => {
      const userId = (ctx as { user: User }).user.id;
      const { videoId, language, voice } = parsedInput;
      const supabase = await createSupabaseServerClient(); // Use user context client

      try {
        const { error, count } = await supabase
          .from("favorites")
          .select("", { count: "exact", head: true }) // Select nothing, just get count
          .eq("user_id", userId)
          .eq("video_id", videoId)
          .eq("language", language)
          .eq("voice", voice);

        if (error) {
          console.error("Error checking favorite status:", error);
          throw appErrors.DATABASE_ERROR;
        }

        return {
          success: true,
          data: { isFavorite: count !== null && count > 0 },
        };
      } catch (error) {
        console.error("Unexpected error fetching favorite status:", error);
        if (error instanceof AppError) throw error;
        throw appErrors.UNEXPECTED_ERROR;
      }
    }
  );

// --- Toggle Favorite Status --- //

const toggleFavoriteSchema = z.object({
  videoId: z.string().uuid(), // Changed from dbVideoId based on mobile type update
  language: z.string(),
  voice: z.string(),
});

interface ToggleFavoriteOutput {
  isFavorite: boolean; // Return the new favorite status
}

export const toggleFavorite = protectedAction
  .schema(toggleFavoriteSchema)
  .action(
    async ({
      parsedInput,
      ctx,
    }): Promise<ActionResponse<ToggleFavoriteOutput>> => {
      const userId = (ctx as { user: User }).user.id;
      const { videoId, language, voice } = parsedInput;
      const supabase = await createSupabaseServerClient(); // Use user context client

      try {
        // 1. Check current status
        const { data: existing, error: checkError } = await supabase
          .from("favorites")
          .select("id")
          .eq("user_id", userId)
          .eq("video_id", videoId)
          .eq("language", language)
          .eq("voice", voice)
          .maybeSingle();

        if (checkError) {
          console.error("Error checking favorite before toggle:", checkError);
          throw appErrors.DATABASE_ERROR;
        }

        let newFavoriteStatus: boolean;

        if (existing) {
          // 2a. Favorite exists, delete it
          console.log(
            `Removing favorite for video ${videoId}, user ${userId}, lang ${language}, voice ${voice}`
          );
          const { error: deleteError } = await supabase
            .from("favorites")
            .delete()
            .eq("id", existing.id); // Delete by specific ID

          if (deleteError) {
            console.error("Error deleting favorite:", deleteError);
            throw appErrors.DATABASE_ERROR;
          }
          newFavoriteStatus = false;
          // The trigger `unmark_resources_as_favorite_trigger` handles resource cleanup
        } else {
          // 2b. Favorite doesn't exist, insert it
          console.log(
            `Adding favorite for video ${videoId}, user ${userId}, lang ${language}, voice ${voice}`
          );
          const { error: insertError } = await supabase
            .from("favorites")
            .insert({
              user_id: userId,
              video_id: videoId,
              language: language,
              voice: voice,
            });

          if (insertError) {
            console.error("Error inserting favorite:", insertError);
            throw appErrors.DATABASE_ERROR;
          }
          newFavoriteStatus = true;
          // The trigger `mark_resources_as_favorite_trigger` handles resource marking
        }

        return {
          success: true,
          data: { isFavorite: newFavoriteStatus },
        };
      } catch (error) {
        console.error("Unexpected error toggling favorite:", error);
        if (error instanceof AppError) throw error;
        throw appErrors.UNEXPECTED_ERROR;
      }
    }
  );

// --- Update Watch History --- //

const updateHistorySchema = z.object({
  videoId: z.string().uuid(), // Changed from dbVideoId based on mobile type update
  position: z.number().min(0),
  language: z.string(), // Added back based on schema
  voice: z.string(), // Added back based on schema
});

// No specific output needed, just success/failure
type UpdateHistoryOutput = null;

export const updateHistory = protectedAction
  .schema(updateHistorySchema)
  .action(
    async ({
      parsedInput,
      ctx,
    }): Promise<ActionResponse<UpdateHistoryOutput>> => {
      const userId = (ctx as { user: User }).user.id;
      const { videoId, position, language, voice } = parsedInput;
      const supabase = await createSupabaseServerClient(); // Use user context client

      try {
        console.log(
          `Updating history for user ${userId}, video ${videoId}, pos ${position}, lang ${language}, voice ${voice}`
        );
        const { error } = await supabase.from("history").upsert(
          {
            user_id: userId,
            video_id: videoId,
            language: language,
            voice: voice,
            last_position: position,
            watched_at: new Date().toISOString(), // Update timestamp on upsert
          },
          {
            // Specify the constraint Supabase should use for conflict detection
            // This should match the unique constraint defined in your schema.sql
            onConflict: "user_id, video_id, language, voice",
            // If using Supabase >= v2.X, ignoreDuplicates is deprecated/changed
            // The default behavior of upsert handles this.
            // ignoreDuplicates: false,
          }
        );

        if (error) {
          console.error("Error upserting watch history:", error);
          // Handle specific errors like constraint violation if needed, though upsert should manage it.
          throw appErrors.DATABASE_ERROR;
        }

        return { success: true, data: null };
      } catch (error) {
        console.error("Unexpected error updating watch history:", error);
        if (error instanceof AppError) throw error;
        throw appErrors.UNEXPECTED_ERROR;
      }
    }
  );
