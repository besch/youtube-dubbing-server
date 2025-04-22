import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  internalRequestFullTranscription, // Updated
  internalTranslateFullContent, // Updated
  internalGenerateAudioChunk,
} from "@/app/actions/videoInternal";
import { AppError, AppErrorCode } from "@/app/actions/actions";

const FUNCTION_SECRET = process.env.FUNCTION_SECRET;

// Define a mapping from action names to the actual action functions
const internalActions: Record<string, Function> = {
  internalRequestFullTranscription, // Updated key
  internalTranslateFullContent, // Updated key
  internalGenerateAudioChunk,
};

// Define the schema for the request body
const triggerActionSchema = z.object({
  actionName: z.string(),
  payload: z.any(), // Keep payload flexible, actions handle specific validation
});

export async function POST(request: NextRequest) {
  // 1. Authorization Check
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${FUNCTION_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    // Execute the action with the provided payload
    // The action itself is expected to return { success: boolean, data?: T, error?: AppError }
    const result = await actionToRun({ parsedInput: payload }); // Pass payload wrapped as expected by next-safe-action

    if (result.success) {
      // Return success with data (even if data is null/empty)
      return NextResponse.json({ success: true, data: result.data ?? null });
    } else {
      // Action returned a controlled error (AppError)
      console.error(
        `Internal action '${actionName}' failed:`,
        JSON.stringify(result.error)
      );
      // Return the structured AppError from the action
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 } // Use 400 for controlled action errors
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
