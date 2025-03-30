"use server";

import { createSafeActionClient } from "next-safe-action";
import { z } from "zod";
import { appErrors } from "@/app/actions/actions";
import { createAdminClient, createServerClient } from "@/lib/supabase";

const action = createSafeActionClient();

// Get user profile
export const getUserProfile = action.action(async () => {
  try {
    // Check authentication
    const supabase = createServerClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.user) {
      return { success: false, error: appErrors.UNAUTHENTICATED };
    }

    // Get user profile
    const adminClient = createAdminClient();
    const { data: profile, error } = await adminClient
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .single();

    if (error) {
      console.error("Error getting user profile:", error);
      return { success: false, error: appErrors.DATABASE_ERROR };
    }

    return {
      success: true,
      data: profile,
    };
  } catch (error) {
    console.error("Error getting user profile:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? {
              code: "UNEXPECTED_ERROR",
              message: error.message,
            }
          : appErrors.UNEXPECTED_ERROR,
    };
  }
});

// Schema for updating user settings
const updateUserSettingsSchema = z.object({
  defaultLanguage: z.string().min(2).max(5),
  defaultVoice: z.enum([
    "alloy",
    "echo",
    "fable",
    "onyx",
    "nova",
    "shimmer",
  ] as const),
});

export const updateUserSettings = action
  .schema(updateUserSettingsSchema)
  .action(async ({ parsedInput }) => {
    const { defaultLanguage, defaultVoice } = parsedInput;

    try {
      // Check authentication
      const supabase = createServerClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        return { success: false, error: appErrors.UNAUTHENTICATED };
      }

      // Update user settings
      const adminClient = createAdminClient();
      const { error } = await adminClient
        .from("profiles")
        .update({
          settings: {
            defaultLanguage,
            defaultVoice,
          },
        })
        .eq("id", session.user.id);

      if (error) {
        console.error("Error updating user settings:", error);
        return { success: false, error: appErrors.DATABASE_ERROR };
      }

      return { success: true };
    } catch (error) {
      console.error("Error updating user settings:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? {
                code: "UNEXPECTED_ERROR",
                message: error.message,
              }
            : appErrors.UNEXPECTED_ERROR,
      };
    }
  });

// Get user history
export const getUserHistory = action.action(async () => {
  try {
    // Check authentication
    const supabase = createServerClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.user) {
      return { success: false, error: appErrors.UNAUTHENTICATED };
    }

    // Get user history
    const adminClient = createAdminClient();
    const { data: history, error } = await adminClient
      .from("history")
      .select(
        `
          *,
          video:videos(*)
        `
      )
      .eq("user_id", session.user.id)
      .order("watched_at", { ascending: false });

    if (error) {
      console.error("Error getting user history:", error);
      return { success: false, error: appErrors.DATABASE_ERROR };
    }

    return {
      success: true,
      data: history,
    };
  } catch (error) {
    console.error("Error getting user history:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? {
              code: "UNEXPECTED_ERROR",
              message: error.message,
            }
          : appErrors.UNEXPECTED_ERROR,
    };
  }
});

// Get user favorites
export const getUserFavorites = action.action(async () => {
  try {
    // Check authentication
    const supabase = createServerClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.user) {
      return { success: false, error: appErrors.UNAUTHENTICATED };
    }

    // Get user favorites
    const adminClient = createAdminClient();
    const { data: favorites, error } = await adminClient
      .from("favorites")
      .select(
        `
          *,
          video:videos(*)
        `
      )
      .eq("user_id", session.user.id)
      .order("added_at", { ascending: false });

    if (error) {
      console.error("Error getting user favorites:", error);
      return { success: false, error: appErrors.DATABASE_ERROR };
    }

    return {
      success: true,
      data: favorites,
    };
  } catch (error) {
    console.error("Error getting user favorites:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? {
              code: "UNEXPECTED_ERROR",
              message: error.message,
            }
          : appErrors.UNEXPECTED_ERROR,
    };
  }
});
