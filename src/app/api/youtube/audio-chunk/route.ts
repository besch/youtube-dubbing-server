import { NextResponse } from "next/server";
import { getAudioChunk } from "@/app/actions/video";

export async function POST(request: Request) {
  try {
    const { videoId, dbVideoId, startTime, endTime, language, voice } =
      await request.json();

    if (
      !videoId ||
      !dbVideoId ||
      startTime === undefined ||
      endTime === undefined ||
      !language ||
      !voice
    ) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_REQUEST",
            message:
              "videoId, dbVideoId, startTime, endTime, language, and voice parameters are required",
          },
        },
        { status: 400 }
      );
    }

    // Call the server action
    const result = await getAudioChunk({
      videoId,
      dbVideoId,
      startTime,
      endTime,
      language,
      voice,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("YouTube audio chunk API error:", error);

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
