import { createSafeActionClient } from "next-safe-action";
import { AppError, appErrors, AppErrorCode } from "./actions"; // Will be created next
import { createSupabaseServerClient } from "@/lib/supabase/serverClient";

// Define a generic server error message
const GENERIC_SERVER_ERROR = "An unexpected error occurred. Please try again.";

export class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionError";
  }
}

// Action client without user authentication requirement
export const publicAction = createSafeActionClient({
  // Optional: Log server errors
  // serverErrorLogFunction: (e) => {
  //   console.error('Unexpected server error in public action:', e)
  // },
  // Transform server errors before returning to the client
  handleServerError(e: unknown) {
    if (e instanceof AppError) {
      // Return the plain object representation of the AppError
      return e.toJSON();
    }
    if (e instanceof ActionError) {
      // Handle ActionError specifically if needed, or return a generic error object
      console.error("ActionError caught:", e);
      // Returning a generic error object ensures consistency
      return new AppError(
        AppErrorCode.UNEXPECTED_ERROR,
        e.message || GENERIC_SERVER_ERROR
      ).toJSON();
    }
    // Log the actual error on the server
    console.error("Unexpected server error in public action:", e);
    // Return a generic AppError plain object to the client
    return new AppError(
      AppErrorCode.UNEXPECTED_ERROR,
      GENERIC_SERVER_ERROR
    ).toJSON();
  },
});

// Create a base client for reuse if needed, or define directly
const baseClient = createSafeActionClient({
  // Optional: Log server errors
  // serverErrorLogFunction: (e) => {
  //  console.error('Unexpected server error in protected action:', e)
  // },
  // Transform server errors before returning to the client
  handleServerError(e: unknown) {
    if (e instanceof AppError) {
      // Return the plain object representation of the AppError
      return e.toJSON();
    }
    if (e instanceof ActionError) {
      // Handle ActionError specifically if needed, or return a generic error object
      console.error("ActionError caught:", e);
      // Returning a generic error object ensures consistency
      return new AppError(
        AppErrorCode.UNEXPECTED_ERROR,
        e.message || GENERIC_SERVER_ERROR
      ).toJSON();
    }
    // Log the actual error on the server
    console.error("Unexpected server error:", e);
    // Return a generic AppError plain object to the client
    return new AppError(
      AppErrorCode.UNEXPECTED_ERROR,
      GENERIC_SERVER_ERROR
    ).toJSON();
  },
});

// Action client that requires user authentication, using the .use() method
export const protectedAction = baseClient.use(async ({ next }) => {
  const supabase = await createSupabaseServerClient(); // Await the client creation
  const { data, error } = await supabase.auth.getUser();

  if (error || !data?.user) {
    throw appErrors.UNAUTHORIZED; // Throw specific AppError
  }

  // Call the next middleware/action with the user context
  return next({ ctx: { user: data.user } });
});
