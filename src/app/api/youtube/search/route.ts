import { NextResponse } from "next/server";
import { searchYoutubeVideos } from "@/lib/youtube-api";

export async function POST(request: Request) {
  try {
    const { query, maxResults = 10 } = await request.json();

    if (!query) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_REQUEST",
            message: "Query parameter is required",
          },
        },
        { status: 400 }
      );
    }

    const results = await searchYoutubeVideos(query, maxResults);

    return NextResponse.json({
      success: true,
      data: results,
    });
  } catch (error) {
    console.error("YouTube search API error:", error);

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
