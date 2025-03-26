import { NextResponse } from "next/server";
import { toggleFavorite } from "@/app/actions/video";

export async function POST(request: Request) {
  try {
    const { videoId, language, voice } = await request.json();

    if (!videoId || !language || !voice) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_REQUEST",
            message: "videoId, language, and voice parameters are required",
          },
        },
        { status: 400 }
      );
    }

    // Call the server action
    const result = await toggleFavorite({
      videoId,
      language,
      voice,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Toggle favorite API error:", error);

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
