import { NextRequest, NextResponse } from "next/server";
import {
  startVideoProcessing,
  startTranscription,
  generateAudioChunk,
} from "@/app/actions/video"; // Import specific actions
// Import other actions as they are created
// import { toggleFavorite } from '@/app/actions/userVideoData'

import { ActionResponse, AppError, AppErrorCode } from "@/app/actions/actions";

// Define the shape of the action functions we expect (simplified for registry)
type ActionFunction = (input: unknown) => Promise<ActionResponse<unknown>>;

// Map action names (derived from URL path) to the actual server action functions
const actionRegistry: Record<string, ActionFunction> = {
  // video actions
  // Cast action functions to 'any' to satisfy the ActionFunction type for now
  "video/startVideoProcessing": startVideoProcessing as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  "video/startTranscription": startTranscription as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  "video/generateAudioChunk": generateAudioChunk as any, // eslint-disable-line @typescript-eslint/no-explicit-any

  // user/favorites actions
  // 'user/toggleFavorite': toggleFavorite as any, // Add when implemented
  // 'user/getFavoriteStatus': getFavoriteStatus as any, // Add when implemented

  // user/history actions
  // 'user/updateHistory': updateHistory as any, // Add when implemented
};

export async function POST(
  request: NextRequest,
  { params }: { params: { actionName: string[] } }
) {
  try {
    const actionName = params.actionName[0];
    const action = actionRegistry[actionName as keyof typeof actionRegistry];

    if (!action) {
      console.error(`Action not found: ${actionName}`);
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
