import { NextRequest, NextResponse } from "next/server";
import {
  startVideoProcessing,
  requestTranscriptionSegment,
  getCompletedTranscriptionSegments,
  generateAudioChunk,
  updateHistory,
  toggleFavorite,
  getFavoriteStatus,
  translateSegmentContent,
  getFavorites,
  getHistory,
  getSuggestedVideos,
  translateVideoTitle,
} from "@/app/actions/video"; // Import specific actions
// Import other actions as they are created
// import { toggleFavorite } from '@/app/actions/userVideoData'

import { ActionResponse, AppError, AppErrorCode } from "@/app/actions/actions";

// Define the shape of the action functions we expect
// Using `any` here is acceptable as the execution logic will handle the specific result structure.
type ActionFunction = (input: any) => Promise<any>; // Keep it simple

// Map action names to the actual server action functions
const actionRegistry: Record<string, ActionFunction> = {
  // video actions
  "video/startVideoProcessing": startVideoProcessing,
  "video/requestTranscriptionSegment": requestTranscriptionSegment,
  "video/getCompletedTranscriptionSegments": getCompletedTranscriptionSegments,
  "video/generateAudioChunk": generateAudioChunk,
  "video/updateHistory": updateHistory,
  "video/toggleFavorite": toggleFavorite,
  "video/getFavoriteStatus": getFavoriteStatus,
  "video/translateSegmentContent": translateSegmentContent,
  "video/getFavorites": getFavorites,
  "video/getHistory": getHistory,
  "video/getSuggestedVideos": getSuggestedVideos,
  "video/translateVideoTitle": translateVideoTitle,

  // user/favorites actions
  // 'user/toggleFavorite': toggleFavorite as any, // Add when implemented
  // 'user/getFavoriteStatus': getFavoriteStatus as any, // Add when implemented

  // user/history actions
  // 'user/updateHistory': updateHistory as any, // Add when implemented
};

export async function POST(request: NextRequest) {
  try {
    // Extract action name from URL path
    const url = new URL(request.url);
    const pathSegments = url.pathname.split("/");

    // Find the segments after /api/actions/
    const actionsIndex = pathSegments.indexOf("actions");
    if (actionsIndex === -1 || actionsIndex + 1 >= pathSegments.length) {
      return NextResponse.json(
        {
          success: false,
          error: new AppError(
            AppErrorCode.INVALID_INPUT,
            "Invalid action path format"
          ),
        },
        { status: 400 }
      );
    }
    const actionSegments = pathSegments.slice(actionsIndex + 1);
    const actionPath = actionSegments.join("/");

    if (!actionPath) {
      return NextResponse.json(
        {
          success: false,
          error: new AppError(
            AppErrorCode.INVALID_INPUT,
            "Invalid action path"
          ),
        },
        { status: 400 }
      );
    }

    const action = actionRegistry[actionPath];

    if (!action) {
      console.error(`Action not found: ${actionPath}`);
      return NextResponse.json(
        {
          success: false,
          error: new AppError(AppErrorCode.INVALID_INPUT, "Action not found"),
        },
        { status: 404 }
      );
    }

    const body = await request.json();
    console.log(`API Route: Executing action ${actionPath} with body:`, body);

    // Execute the action function
    const result = await action(body);
    console.log(`API Route: Action ${actionPath} executed. Result:`, result);

    // --- Handle SafeActionResult ---
    if (!result) {
      // Handle cases where the action might unexpectedly return undefined
      console.error(
        `API Route: Action ${actionPath} returned undefined result.`
      );
      return NextResponse.json(
        {
          success: false,
          error: new AppError(
            AppErrorCode.UNEXPECTED_ERROR,
            "Action returned undefined"
          ).toJSON(),
        },
        { status: 500 }
      );
    }

    // Check for server error
    if (result.serverError) {
      console.error(
        `API Route: Action ${actionPath} resulted in server error:`,
        result.serverError
      );
      // Note: handleServerError in safe-action.ts should format this,
      // but we construct a response here just in case.
      // The actual error object might be complex, so we send a generic message.
      return NextResponse.json(
        {
          success: false,
          error: new AppError(
            AppErrorCode.UNEXPECTED_ERROR,
            result.serverError
          ).toJSON(),
        },
        { status: 500 }
      );
    }

    // Check for validation error
    if (result.validationError) {
      console.warn(
        `API Route: Action ${actionPath} resulted in validation error:`,
        result.validationError
      );
      // Send back the validation errors
      return NextResponse.json(
        {
          success: false,
          error: {
            code: AppErrorCode.VALIDATION_ERROR,
            message: "Input validation failed",
            issues: result.validationError,
          },
        },
        { status: 400 }
      );
    }

    // If no errors, assume success and return data
    // Ensure the structure matches client expectations ({ success: true, data: ... })
    return NextResponse.json({ success: true, data: result.data });
  } catch (error) {
    console.error(
      `API Route: Unexpected error in POST handler for ${request.url}:`,
      error
    );
    // Generic catch block for errors *outside* the action execution (e.g., request.json() failure)
    return NextResponse.json(
      {
        success: false,
        error: new AppError(
          AppErrorCode.UNEXPECTED_ERROR,
          "Internal server error in API handler"
        ).toJSON(),
      },
      { status: 500 }
    );
  }
}
