import { NextResponse } from "next/server";
import { updateHistory } from "@/app/actions/video";

export async function POST(request: Request) {
  try {
    const { videoId, position } = await request.json();

    if (!videoId || position === undefined) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_REQUEST",
            message: "videoId and position parameters are required",
          },
        },
        { status: 400 }
      );
    }

    // Call the server action
    const result = await updateHistory({
      videoId,
      position,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Update history API error:", error);

    return NextResponse.json(
      {
        success: false,
        error: {
          code: "UNEXPECTED_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "An unexpected error occurred",
        },
      },
      { status: 500 }
    );
  }
}
