import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  internalRequestFullTranscription, // Updated
  internalTranslateFullContent, // Updated
  internalGenerateAudioChunk,
  internalSpawnTtsJobs,
} from "@/app/actions/videoInternal";
import {
  AppError,
  AppErrorCode,
  type ActionResponse,
} from "@/app/actions/actions";

// Read the correct environment variable name used in Vercel
const FUNCTION_SECRET = process.env.SUPABASE_FUNCTION_SECRET;

// Define a mapping from action names to the actual action functions
// Using 'any' to satisfy linter rule and avoid complex type mismatches
const internalActions: Record<string, any> = {
  internalRequestFullTranscription, // Updated key
  internalTranslateFullContent, // Updated key
  internalGenerateAudioChunk,
  internalSpawnTtsJobs,
};

// Define the schema for the request body
const triggerActionSchema = z.object({
  actionName: z.string(),
  payload: z.any(), // Keep payload flexible, actions handle specific validation
});

export async function POST(request: NextRequest) {
  // // 1. Authorization Check
  // const authHeader = request.headers.get("authorization");
  // if (authHeader !== `Bearer ${FUNCTION_SECRET}`) {
  //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // }

  // 2. Parse and Validate Request Body
  let parsedBody;
  try {
    const body = await request.json();
    parsedBody = triggerActionSchema.parse(body);
  } catch (error) {
    console.error("Invalid request body:", error);
    return NextResponse.json(
      {
        error:
          error instanceof z.ZodError
            ? error.format()
            : "Invalid request format",
      },
      { status: 400 }
    );
  }

  const { actionName, payload } = parsedBody;

  // 3. Find and Execute Action
  const actionToRun = internalActions[actionName];

  if (!actionToRun) {
    console.error(`Unknown internal action requested: ${actionName}`);
    return NextResponse.json(
      { error: `Unknown action: ${actionName}` },
      { status: 404 }
    );
  }

  // 4. Execute the action and handle response
  try {
    console.log(`Executing internal action: ${actionName}`);
    const result = await actionToRun(payload);

    // Log the entire result object received from the action execution
    console.log(
      `[DEBUG] Raw result from action '${actionName}':`,
      JSON.stringify(result, null, 2)
    );

    // Check for undefined result
    if (!result) {
      console.error(
        `Internal action '${actionName}' unexpectedly returned undefined.`
      );
      throw new AppError(
        AppErrorCode.UNEXPECTED_ERROR,
        `Action '${actionName}' returned undefined.`
      );
    }

    // --- Check for next-safe-action specific errors --- //
    // Check for PLURAL validationErrors
    if (result.validationErrors) {
      console.error(
        `Internal action '${actionName}' failed due to input validation:`,
        JSON.stringify(result.validationErrors) // Log plural
      );
      // Return validation error details
      return NextResponse.json(
        {
          success: false,
          error: {
            code: AppErrorCode.INVALID_INPUT,
            message: "Input validation failed",
            details: result.validationErrors, // Use plural
          },
        },
        { status: 400 }
      );
    }

    // Check for singular serverError
    if (result.serverError) {
      console.error(
        `Internal action '${actionName}' failed due to a server error before execution:`,
        JSON.stringify(result.serverError)
      );
      // Return server error details
      return NextResponse.json(
        {
          success: false,
          error: {
            code: AppErrorCode.UNEXPECTED_ERROR,
            message: "Server error during action setup",
            details: result.serverError,
          },
        },
        { status: 500 }
      );
    }
    // --- End next-safe-action specific error checks --- //

    // Check if the action succeeded (result.data is present)
    if (result.data) {
      // Check if the action's internal logic returned an error
      if (result.data.success === false && result.data.error) {
        console.error(
          `Internal action '${actionName}' returned a failure:`,
          result.data.error
        );
        return NextResponse.json(
          { success: false, error: result.data.error },
          { status: 400 } // Or 500 depending on error type?
        );
      }
      // Action succeeded
      console.log(`Internal action '${actionName}' executed successfully.`);
      return NextResponse.json({ success: true, data: result.data ?? null });
    } else {
      // Action failed without specific validation/server errors (unexpected)
      console.error(
        `Internal action '${actionName}' failed unexpectedly. Raw result:`,
        JSON.stringify(result)
      );
      return NextResponse.json(
        {
          success: false,
          error: {
            code: AppErrorCode.UNEXPECTED_ERROR,
            message: `Action '${actionName}' failed unexpectedly.`,
          },
        },
        { status: 500 }
      );
    }
  } catch (error: unknown) {
    // Handle unexpected errors during action execution
    console.error(`Unexpected error executing action '${actionName}':`, error);
    const appErr = new AppError(
      AppErrorCode.UNEXPECTED_ERROR,
      error instanceof Error ? error.message : "Unknown internal server error"
    );
    return NextResponse.json(
      { success: false, error: appErr },
      { status: 500 }
    );
  }
}
