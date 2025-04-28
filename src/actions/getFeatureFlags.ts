"use server";

import { createSafeActionClient } from "next-safe-action";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/serverClient";
import {
  appErrors,
  AppError,
  type ActionResponse,
} from "@/app/actions/actions";

interface FeatureFlag {
  feature_name: string;
  is_enabled: boolean;
}

// No input schema needed for fetching all flags
const schema = z.object({});

// Define the expected output structure
interface GetFeatureFlagsOutput {
  flags: Record<string, boolean>;
}

export const getFeatureFlags = createSafeActionClient().action(
  async (): Promise<ActionResponse<GetFeatureFlagsOutput>> => {
    try {
      const supabase = await createSupabaseServerClient();

      // TODO: Regenerate Supabase types to include 'features' table
      // Cast to 'any' as a temporary workaround
      const { data, error } = await (supabase as any)
        .from("features")
        .select("feature_name, is_enabled");

      if (error) {
        console.error("Error fetching feature flags:", error);
        throw appErrors.DATABASE_ERROR;
      }

      // Cast data to any[] temporarily due to Supabase type issue
      const flags = ((data || []) as any[]).reduce(
        (acc: Record<string, boolean>, flag: FeatureFlag) => {
          // Basic check to ensure flag has expected properties
          if (
            flag &&
            typeof flag.feature_name === "string" &&
            typeof flag.is_enabled === "boolean"
          ) {
            acc[flag.feature_name] = flag.is_enabled;
          }
          return acc;
        },
        {} as Record<string, boolean>
      );

      return { success: true, data: { flags } };
    } catch (error) {
      console.error("Unexpected error in getFeatureFlags:", error);
      const finalError =
        error instanceof AppError
          ? error
          : new AppError(
              appErrors.UNEXPECTED_ERROR.code,
              `Failed to fetch feature flags: ${
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
