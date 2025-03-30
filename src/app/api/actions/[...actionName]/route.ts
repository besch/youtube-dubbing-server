import { NextRequest, NextResponse } from "next/server";
import { startVideoProcessing } from "@/app/actions/video"; // Import specific actions
// Import other actions as they are created
// import { toggleFavorite } from '@/app/actions/userVideoData'

import {
  ActionResponse,
  AppError,
  AppErrorCode,
  appErrors,
} from "@/app/actions/actions";

// Define the shape of the action functions we expect (simplified for registry)
type ActionFunction = (input: unknown) => Promise<ActionResponse<unknown>>;

// Map action names (derived from URL path) to the actual server action functions
const actionRegistry: Record<string, ActionFunction> = {
  // video actions
  // Cast action functions to 'any' to satisfy the ActionFunction type for now
  "video/startVideoProcessing": startVideoProcessing as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  // 'video/startTranscription': startTranscription as any, // Add when implemented
  // 'video/generateAudioChunk': generateAudioChunk as any, // Add when implemented

  // user/favorites actions
  // 'user/toggleFavorite': toggleFavorite as any, // Add when implemented
  // 'user/getFavoriteStatus': getFavoriteStatus as any, // Add when implemented

  // user/history actions
  // 'user/updateHistory': updateHistory as any, // Add when implemented
};

export async function POST(req: NextRequest) {
  try {
    const urlPath = req.nextUrl.pathname;
    // Extract action name, e.g., "/api/actions/video/startVideoProcessing" -> "video/startVideoProcessing"
    const actionSegments = urlPath.split("/api/actions/")[1]?.split("/");
    if (
      !actionSegments ||
      actionSegments.length === 0 ||
      actionSegments.includes("")
    ) {
      console.error("Invalid action path:", urlPath);
      return NextResponse.json(
        {
          success: false,
          error: new AppError(
            AppErrorCode.INVALID_INPUT,
            "Invalid action path."
          ).toJSON(),
        },
        { status: 400 }
      );
    }
    const actionName = actionSegments.join("/");
    console.log(`API route received request for action: ${actionName}`);

    // Find the action function in the registry
    const actionFunction = actionRegistry[actionName];

    if (!actionFunction) {
      console.error(`Action not found in registry: ${actionName}`);
      return NextResponse.json(
        {
          success: false,
          error: new AppError(
            AppErrorCode.RECORD_NOT_FOUND,
            `Action '${actionName}' not found.`
          ).toJSON(),
        },
        { status: 404 }
      );
    }

    // Parse the request body
    let input: Record<string, unknown>;
    try {
      input = await req.json();
      console.log(`Action [${actionName}] received input:`, input);
    } catch (error) {
      console.error(
        `Error parsing JSON body for action [${actionName}]:`,
        error
      );
      return NextResponse.json(
        {
          success: false,
          error: new AppError(
            AppErrorCode.INVALID_INPUT,
            "Invalid JSON request body."
          ).toJSON(),
        },
        { status: 400 }
      );
    }

    // Execute the server action
    // next-safe-action handles input validation and internal error catching
    const result = await actionFunction(input);

    // Return the result
    if (!result.success) {
      console.error(`Action [${actionName}] failed:`, result.error);
      // Determine appropriate status code based on error type
      let statusCode = 500; // Default to internal server error
      if (result.error instanceof AppError) {
        switch (result.error.code) {
          case AppErrorCode.VALIDATION_ERROR:
          case AppErrorCode.INVALID_INPUT:
            statusCode = 400; // Bad Request
            break;
          case AppErrorCode.UNAUTHENTICATED:
          case AppErrorCode.UNAUTHORIZED:
            statusCode = 401; // Unauthorized (or 403 Forbidden)
            break;
          case AppErrorCode.RECORD_NOT_FOUND:
            statusCode = 404; // Not Found
            break;
          // Add other specific error codes if needed
        }
        return NextResponse.json(
          { success: false, error: result.error.toJSON() },
          { status: statusCode }
        );
      }
      // For unexpected errors not caught as AppError (should be rare with safe-action client)
      return NextResponse.json(
        { success: false, error: appErrors.UNEXPECTED_ERROR.toJSON() },
        { status: 500 }
      );
    }

    console.log(`Action [${actionName}] executed successfully.`);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    // Catch any completely unexpected errors during route handling itself
    console.error("[API Actions Route Handler] Unexpected error:", error);
    return NextResponse.json(
      { success: false, error: appErrors.UNEXPECTED_ERROR.toJSON() },
      { status: 500 }
    );
  }
}
