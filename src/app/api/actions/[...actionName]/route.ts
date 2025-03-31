import { NextRequest, NextResponse } from "next/server";
import {
  startVideoProcessing,
  startTranscription,
  generateAudioChunk,
} from "@/app/actions/video"; // Import specific actions
// Import other actions as they are created
// import { toggleFavorite } from '@/app/actions/userVideoData'

import { ActionResponse, AppError, AppErrorCode } from "@/app/actions/actions";

// Define the shape of the action functions we expect
type ActionFunction = (input: unknown) => Promise<ActionResponse<unknown>>;

// Map action names to the actual server action functions
const actionRegistry: Record<string, ActionFunction> = {
  // video actions
  "video/startVideoProcessing": startVideoProcessing as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  "video/startTranscription": startTranscription as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  "video/generateAudioChunk": generateAudioChunk as any, // eslint-disable-line @typescript-eslint/no-explicit-any

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
    const actionSegments = pathSegments.slice(
      pathSegments.indexOf("actions") + 1
    );
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
    const result = await action(body);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Action error:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof AppError
            ? error
            : new AppError(
                AppErrorCode.UNEXPECTED_ERROR,
                "Internal server error"
              ),
      },
      { status: 500 }
    );
  }
}
