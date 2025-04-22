"use server";

import { z } from "zod";
import type { Tables } from "@/types/supabase";
import { protectedAction } from "../safe-action";
import { supabaseServiceRoleClient } from "@/lib/supabase/serviceRoleClient";
import { ActionResponse, AppError, AppErrorCode, appErrors } from "../actions";

// --- Toggle Favorite Action --- //
const toggleFavoriteSchema = z.object({
  dbVideoId: z.string().uuid(),
  language: z.string(), // Simple lang code
  voice: z.string(), // Voice identifier
});

type ToggleFavoriteOutput = {
  isFavorite: boolean;
};

export const toggleFavorite = protectedAction
  .schema(toggleFavoriteSchema)
  .action(
    async ({
      parsedInput,
      ctx,
    }): Promise<ActionResponse<ToggleFavoriteOutput>> => {
      const userId = ctx.user.id;
      const { dbVideoId, language, voice } = parsedInput;

      try {
        const { data: existingFavorite, error: checkError } =
          await supabaseServiceRoleClient
            .from("favorites")
            .select("id")
            .eq("user_id", userId)
            .eq("video_id", dbVideoId)
            .eq("language", language)
            .eq("voice", voice)
            .maybeSingle();

        if (checkError) {
          console.error("Error checking favorite status:", checkError);
          throw appErrors.DATABASE_ERROR;
        }

        let isNowFavorite: boolean;

        if (existingFavorite) {
          console.log(`Unfavoriting video ${dbVideoId} for user ${userId}`);
          const { error: deleteError } = await supabaseServiceRoleClient
            .from("favorites")
            .delete()
            .match({ id: existingFavorite.id });

          if (deleteError) {
            console.error("Error deleting favorite:", deleteError);
            throw appErrors.DATABASE_ERROR;
          }
          isNowFavorite = false;
        } else {
          console.log(`Favoriting video ${dbVideoId} for user ${userId}`);
          const { error: insertError } = await supabaseServiceRoleClient
            .from("favorites")
            .insert({
              user_id: userId,
              video_id: dbVideoId,
              language: language,
              voice: voice,
            });

          if (insertError) {
            console.error("Error inserting favorite:", insertError);
            throw appErrors.DATABASE_ERROR;
          }
          isNowFavorite = true;
        }

        return { success: true, data: { isFavorite: isNowFavorite } };
      } catch (error: unknown) {
        console.error("Caught raw error in toggleFavorite action:", error);
        if (error instanceof AppError) {
          throw error;
        } else {
          let message = "Failed to toggle favorite status.";
          if (
            typeof error === "object" &&
            error !== null &&
            "message" in error &&
            typeof error.message === "string"
          ) {
            message = error.message;
          }
          const wrappedError = new AppError(
            AppErrorCode.DATABASE_ERROR,
            message
          );
          throw wrappedError;
        }
      }
    }
  );

// --- Get Favorite Status Action --- //
const getFavoriteStatusSchema = z.object({
  dbVideoId: z.string().uuid(),
  language: z.string(), // Simple lang code
  voice: z.string(), // Voice identifier
});

// Output type is the same as ToggleFavoriteOutput
type GetFavoriteStatusOutput = ToggleFavoriteOutput;

export const getFavoriteStatus = protectedAction
  .schema(getFavoriteStatusSchema)
  .action(
    async ({
      parsedInput,
      ctx,
    }): Promise<ActionResponse<GetFavoriteStatusOutput>> => {
      const userId = ctx.user.id;
      const { dbVideoId, language, voice } = parsedInput;

      try {
        const { count, error: checkError } = await supabaseServiceRoleClient
          .from("favorites")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("video_id", dbVideoId)
          .eq("language", language)
          .eq("voice", voice);

        if (checkError) {
          console.error("Error checking favorite status:", checkError);
          throw appErrors.DATABASE_ERROR;
        }

        const isFavorite = (count ?? 0) > 0;

        console.log(
          `Favorite status for user ${userId}, video ${dbVideoId}: ${isFavorite}`
        );
        return { success: true, data: { isFavorite: isFavorite } };
      } catch (error) {
        console.error("Error in getFavoriteStatus action:", error);
        throw error;
      }
    }
  );

// --- Action: Get Favorites ---

const FavoriteItemSchema = z.object({
  favoriteId: z.string().uuid(),
  videoId: z.string().uuid(),
  youtubeId: z.string(),
  title: z.string().nullable(), // Use nullable based on mapping
  thumbnailUrl: z.string().url().nullable(), // Use nullable based on mapping
  duration: z.number().int().positive().nullable(), // Use nullable based on mapping
  language: z.string(),
  voice: z.string(),
  addedAt: z.string().datetime(),
});
export type FavoriteItem = z.infer<typeof FavoriteItemSchema>;

export const getFavorites = protectedAction.action(
  async ({ ctx }): Promise<ActionResponse<FavoriteItem[]>> => {
    const userId = ctx.user.id;
    const supabase = supabaseServiceRoleClient;

    console.log(`Fetching favorites for user: ${userId}`);

    try {
      const { data, error } = await supabase
        .from("favorites")
        .select(
          `
          id,
          added_at,
          language,
          voice,
          video_id,
          videos ( youtube_id, title, thumbnail_url, duration )
        `
        )
        .eq("user_id", userId)
        .order("added_at", { ascending: false });

      if (error) {
        console.error(`DB error fetching favorites for user ${userId}:`, error);
        throw appErrors.DATABASE_ERROR;
      }

      if (!data) {
        return { success: true, data: [] };
      }

      const mappedData = data
        .map((fav) => {
          const video = fav.videos as Tables<"videos"> | null;
          if (!video || !fav.added_at) {
            console.warn(
              `Skipping favorite ${fav.id} due to missing video or added_at data.`
            );
            return null;
          }

          return {
            favoriteId: fav.id,
            videoId: fav.video_id,
            youtubeId: video.youtube_id,
            title: video.title ?? null, // Ensures string | null
            thumbnailUrl: video.thumbnail_url ?? null, // Ensures string | null
            duration: video.duration ?? null, // Ensures number | null
            language: fav.language,
            voice: fav.voice,
            addedAt: new Date(fav.added_at).toISOString(),
          };
        })
        .filter((item) => item !== null);

      const validation = z.array(FavoriteItemSchema).safeParse(mappedData);

      if (!validation.success) {
        console.error(
          "Favorites data validation failed:",
          validation.error.errors
        );
        throw new AppError(
          AppErrorCode.UNEXPECTED_ERROR,
          "Failed to validate favorites data structure."
        );
      }

      console.log(
        `Found ${validation.data.length} favorites for user ${userId}`
      );
      return { success: true, data: validation.data };
    } catch (error: unknown) {
      console.error(`Error in getFavorites action for user ${userId}:`, error);
      const appErr =
        error instanceof AppError ? error : appErrors.UNEXPECTED_ERROR;
      return { success: false, error: appErr };
    }
  }
);
