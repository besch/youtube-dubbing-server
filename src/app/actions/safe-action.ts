import { createSafeActionClient } from "next-safe-action";
import { AppError, appErrors, AppErrorCode } from "./actions"; // Will be created next
import { createSupabaseServerClient } from "@/lib/supabase/serverClient";
import { headers } from "next/headers"; // Import headers

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
    console.log("handleServerError received error:", e); // Log the raw error
    if (e instanceof AppError) {
      // Return the plain object representation of the AppError
      const errorJson = e.toJSON();
      console.log("handleServerError returning AppError JSON:", errorJson);
      return errorJson;
    }
    if (e instanceof ActionError) {
      // Handle ActionError specifically if needed, or return a generic error object
      console.error("ActionError caught:", e);
      // Returning a generic error object ensures consistency
      const errorJson = new AppError(
        AppErrorCode.UNEXPECTED_ERROR,
        e.message || GENERIC_SERVER_ERROR
      ).toJSON();
      console.log(
        "handleServerError returning ActionError as JSON:",
        errorJson
      );
      return errorJson;
    }
    // Log the actual error on the server
    console.error("Unexpected server error in public action:", e);
    // Return a generic AppError plain object to the client
    const errorJson = new AppError(
      AppErrorCode.UNEXPECTED_ERROR,
      GENERIC_SERVER_ERROR
    ).toJSON();
    console.log("handleServerError returning generic error JSON:", errorJson);
    return errorJson;
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
    console.log("handleServerError (baseClient) received error:", e); // Log the raw error
    if (e instanceof AppError) {
      // Return the plain object representation of the AppError
      const errorJson = e.toJSON();
      console.log(
        "handleServerError (baseClient) returning AppError JSON:",
        errorJson
      );
      return errorJson;
    }
    if (e instanceof ActionError) {
      // Handle ActionError specifically if needed, or return a generic error object
      console.error("ActionError caught (baseClient):", e);
      // Returning a generic error object ensures consistency
      const errorJson = new AppError(
        AppErrorCode.UNEXPECTED_ERROR,
        e.message || GENERIC_SERVER_ERROR
      ).toJSON();
      console.log(
        "handleServerError (baseClient) returning ActionError as JSON:",
        errorJson
      );
      return errorJson;
    }
    // Log the actual error on the server
    console.error("Unexpected server error (baseClient):", e);
    // Return a generic AppError plain object to the client
    const errorJson = new AppError(
      AppErrorCode.UNEXPECTED_ERROR,
      GENERIC_SERVER_ERROR
    ).toJSON();
    console.log(
      "handleServerError (baseClient) returning generic error JSON:",
      errorJson
    );
    return errorJson;
  },
});

// Action client that requires user authentication, using the .use() method
export const protectedAction = baseClient.use(async ({ next }) => {
  // Read Authorization header by awaiting headers()
  const headerList = await headers(); // Await the headers object
  const authHeader = headerList.get("authorization"); // Access the specific header
  const token = authHeader?.split(" ")[1]; // Get token part after "Bearer "

  if (!token) {
    console.log("Protected action: No token found in Authorization header.");
    throw appErrors.UNAUTHORIZED; // Throw specific AppError
  }

  // Validate token using supabase client
  // NOTE: We still create the server client, although getUser(token) might not strictly need it,
  // it keeps the pattern consistent and potentially useful if other supabase operations were needed here.
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser(token); // Pass token here

  if (error || !data?.user) {
    console.error(
      "Protected action: Token validation failed or no user found.",
      error
    );
    throw appErrors.UNAUTHORIZED; // Throw specific AppError
  }

  // Call the next middleware/action with the user context
  console.log(`Protected action: User ${data.user.id} authorized.`);
  return next({ ctx: { user: data.user } });
});
