import { NextResponse } from "next/server";
import { processYoutubeUrl } from "@/app/actions/video";

export async function POST(request: Request) {
  try {
    const { url, language, voice } = await request.json();

    if (!url || !language || !voice) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_REQUEST",
            message: "URL, language, and voice parameters are required",
          },
        },
        { status: 400 }
      );
    }

    // Call the server action
    const result = await processYoutubeUrl({
      url,
      language,
      voice,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("YouTube process API error:", error);

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
