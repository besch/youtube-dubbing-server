import { createSafeActionClient } from "next-safe-action";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/serverClient";
import { headers } from "next/headers";
import { AppError, appErrors, AppErrorCode } from "./actions";

// Create a public action client (no auth required)
export const publicAction = createSafeActionClient({
  handleReturnedServerError: (error) => {
    console.error("Server action error:", error);
    return {
      serverError:
        error instanceof Error ? error.message : "An unexpected error occurred",
    };
  },
});

// Create a protected action client (requires auth)
export const protectedAction = createSafeActionClient({
  handleReturnedServerError: (error) => {
    console.error("Server action error:", error);
    return {
      serverError:
        error instanceof Error ? error.message : "An unexpected error occurred",
    };
  },
  middleware: async (parsedInput: unknown) => {
    const authHeader = headers().get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      throw new AppError(AppErrorCode.UNAUTHORIZED);
    }

    const token = authHeader.split(" ")[1];
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      throw new AppError(AppErrorCode.UNAUTHORIZED);
    }

    return { input: parsedInput, user: data.user };
  },
});
