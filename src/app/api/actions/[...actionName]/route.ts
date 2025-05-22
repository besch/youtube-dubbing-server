import { NextRequest, NextResponse } from "next/server";
import { getVideoByUrl } from "@/app/actions/video/video";
import { searchMovies } from "@/app/actions/movie/search";
import { fetchSubtitles } from "@/app/actions/subtitle/fetch";
import { fetchYouTubeSubtitles } from "@/app/actions/subtitle/fetch-youtube";
import { AppError, AppErrorCode } from "@/app/actions/actions";
import { generateAudioChunk } from "@/app/actions/audio/generation";

type ActionFunction = (input: any) => Promise<any>;

const actionRegistry: Record<string, ActionFunction> = {
  generateAudio: generateAudioChunk,
  "video/getVideoByUrl": getVideoByUrl,
  "movie/search": searchMovies,
  "subtitle/fetch": fetchSubtitles,
  "subtitle/fetch-youtube": fetchYouTubeSubtitles,
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
    if (result.data) {
      return NextResponse.json(result.data);
    } else {
      console.error(
        `API Route: Action ${actionPath} succeeded but returned no data.`
      );
      return NextResponse.json(
        {
          success: false,
          error: new AppError(
            AppErrorCode.UNEXPECTED_ERROR,
            "Action succeeded but returned no data"
          ).toJSON(),
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error(
      `API Route: Unexpected error in POST handler for ${request.url}:`,
      error
    );
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
