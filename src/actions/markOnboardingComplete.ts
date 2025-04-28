"use server";

import { protectedAction } from "@/app/actions/safe-action"; // Corrected path
import { z } from "zod";
import { supabaseServiceRoleClient } from "@/lib/supabase/serviceRoleClient";
import {
  appErrors,
  AppError,
  type ActionResponse,
} from "@/app/actions/actions";
import type { User } from "@supabase/supabase-js"; // Import User type for context
// import { createSupabaseServerClient } from '@/lib/supabase/serverClient' // No longer needed directly
// import { getUserData } from '@/lib/auth/userData' // User comes from ctx now

// No specific input schema needed, user ID comes from context
const schema = z.object({});

interface ActionContext {
  user: User;
}

export const markOnboardingComplete = protectedAction
  .schema(schema)
  .action(
    async ({ ctx }: { ctx: ActionContext }): Promise<ActionResponse<null>> => {
      // Add type for ctx
      // Access ctx
      try {
        const userId = ctx.user.id; // Get user ID from context
        const supabase = supabaseServiceRoleClient; // Use service role client for potential RLS bypass if needed

        // TODO: Regenerate Supabase types to include 'has_completed_onboarding'
        const { error } = await supabase
          .from("profiles")
          .update({ has_completed_onboarding: true } as any) // Cast update payload to any temporarily
          .eq("id", userId);

        if (error) {
          console.error(
            "Error marking onboarding complete for user:",
            userId,
            error
          );
          // Consider mapping specific DB errors (e.g., RLS) if applicable
          throw appErrors.DATABASE_ERROR;
        }

        console.log(`User ${userId} marked onboarding as complete.`);
        return { success: true, data: null };
      } catch (error) {
        console.error("Unexpected error in markOnboardingComplete:", error);
        const finalError =
          error instanceof AppError
            ? error
            : new AppError(
                appErrors.UNEXPECTED_ERROR.code,
                `Failed to mark onboarding complete: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`
              );
        return {
          success: false,
          error: finalError,
        };
      }
    }
  );
