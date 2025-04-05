"use server";

import { z } from "zod";
import {
  createSupabaseServerClient,
  createSupabaseAdminClient,
} from "@/lib/supabase/serverClient";
import { protectedAction } from "../safe-action"; // Use protectedAction for auth
import type { ActionResponse } from "../actions"; // Reuse ActionResponse
import { AppError, appErrors } from "../actions"; // Reuse AppError/appErrors

// No input schema needed for this action
const schema = z.object({});

export const deleteAccountAction = protectedAction
  .schema(schema)
  .action(async ({ ctx }): Promise<ActionResponse<null>> => {
    const userId = ctx.user.id;

    console.log(
      `[deleteAccountAction] Attempting to delete account for user: ${userId}`
    ); // Add log

    try {
      const supabase = await createSupabaseServerClient();

      // 1. Delete related data (profile, history, favorites)
      // Supabase handles cascading deletes if set up correctly in schema,
      // but explicit deletes ensure cleanup.
      // Note: profile deletion might be handled by auth trigger, but explicit is safer.

      const { error: historyError } = await supabase
        .from("history")
        .delete()
        .eq("user_id", userId);

      if (historyError) {
        console.error(
          `[deleteAccountAction] Error deleting history for ${userId}:`,
          historyError
        );
        throw new AppError(
          appErrors.DATABASE_ERROR.code,
          `Failed to delete history: ${historyError.message}`
        );
      }
      console.log(
        `[deleteAccountAction] Successfully deleted history for user: ${userId}`
      ); // Add log

      const { error: favoritesError } = await supabase
        .from("favorites")
        .delete()
        .eq("user_id", userId);

      if (favoritesError) {
        console.error(
          `[deleteAccountAction] Error deleting favorites for ${userId}:`,
          favoritesError
        );
        throw new AppError(
          appErrors.DATABASE_ERROR.code,
          `Failed to delete favorites: ${favoritesError.message}`
        );
      }
      console.log(
        `[deleteAccountAction] Successfully deleted favorites for user: ${userId}`
      ); // Add log

      // Optionally delete profile if not handled by trigger (belt and suspenders)
      const { error: profileError } = await supabase
        .from("profiles")
        .delete()
        .eq("id", userId);

      if (profileError) {
        // Log warning, but might not be critical if auth deletion handles it
        console.warn(
          `[deleteAccountAction] Error deleting profile for ${userId} (might be handled by auth):`,
          profileError
        );
      } else {
        console.log(
          `[deleteAccountAction] Successfully deleted profile for user: ${userId}`
        ); // Add log
      }

      // 2. Delete the user from Supabase Auth (requires SERVICE_ROLE_KEY)
      // Ensure your server client is configured to use the service role key
      // for administrative actions like deleting users.
      const supabaseAdmin = await createSupabaseAdminClient(); // Use the admin client
      const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(
        userId
      );

      if (authError) {
        console.error(
          `[deleteAccountAction] Error deleting user from auth ${userId}:`,
          authError
        );
        // If data deletion succeeded but auth deletion failed, this is a problem.
        // Consider logging this as a critical error.
        throw new AppError(
          appErrors.AUTH_OPERATION_FAILED.code, // Use the specific auth error code
          `Failed to delete user authentication: ${authError.message}`
        );
      }
      console.log(
        `[deleteAccountAction] Successfully deleted user from auth: ${userId}`
      ); // Add log

      // 3. Return success (no data needed)
      return { success: true, data: null };
    } catch (error) {
      console.error(`[deleteAccountAction] Failed for user ${userId}:`, error); // Log the caught error
      if (error instanceof AppError) {
        return { success: false, error: error };
      }
      // Catch unexpected errors
      return { success: false, error: appErrors.UNEXPECTED_ERROR };
    }
  });
