import { NextRequest, NextResponse } from "next/server";
import { getVideoByUrl } from "@/app/actions/video/video";
import { searchMovies } from "@/app/actions/movie/search";
import { fetchSubtitles } from "@/app/actions/subtitle/fetch";
import { fetchYouTubeSubtitles } from "@/app/actions/subtitle/fetch-youtube";
import { AppError, AppErrorCode } from "@/app/actions/actions";
import { generateAudioChunk } from "@/app/actions/audio/generation";
import { checkVideoLimit } from "@/app/actions/subscription";
import { validateExtensionRequest, setCorsHeaders } from "@/lib/extension-auth";

type ActionFunction = (input: any) => Promise<any>;

// Helper function to create responses with CORS headers
function createCorsResponse(data: any, status: number = 200): NextResponse {
  const response = NextResponse.json(data, { status });
  const extensionId = process.env.NEXT_PUBLIC_EXTENSION_ID;
  if (extensionId) {
    return setCorsHeaders(response, extensionId) as NextResponse;
  }
  return response;
}

const actionRegistry: Record<string, ActionFunction> = {
  generateAudio: generateAudioChunk,
  "video/getVideoByUrl": getVideoByUrl,
  "movie/search": searchMovies,
  "subtitle/fetch": fetchSubtitles,
  "subtitle/fetch-youtube": fetchYouTubeSubtitles,
  "subscription/checkVideoLimit": checkVideoLimit,
};

// Handle CORS preflight requests
export async function OPTIONS(request: NextRequest) {
  const allowedExtensionId = process.env.NEXT_PUBLIC_EXTENSION_ID;

  if (!allowedExtensionId) {
    return NextResponse.json(
      { error: "Extension authentication not configured" },
      { status: 500 }
    );
  }

  const response = new NextResponse(null, { status: 200 });
  return setCorsHeaders(response, allowedExtensionId);
}

export async function POST(request: NextRequest) {
  try {
    // Validate Chrome extension request
    const authResult = validateExtensionRequest(request);
    if (!authResult.isValid) {
      console.warn("Unauthorized request blocked:", authResult.error?.message);
      return createCorsResponse(
        {
          success: false,
          error: authResult.error?.toJSON(),
        },
        401
      );
    }

    // Extract action name from URL path
    const url = new URL(request.url);
    const pathSegments = url.pathname.split("/");

    // Find the segments after /api/actions/
    const actionsIndex = pathSegments.indexOf("actions");
    if (actionsIndex === -1 || actionsIndex + 1 >= pathSegments.length) {
      return createCorsResponse(
        {
          success: false,
          error: new AppError(
            AppErrorCode.INVALID_INPUT,
            "Invalid action path format"
          ),
        },
        400
      );
    }
    const actionSegments = pathSegments.slice(actionsIndex + 1);
    const actionPath = actionSegments.join("/");

    if (!actionPath) {
      return createCorsResponse(
        {
          success: false,
          error: new AppError(
            AppErrorCode.INVALID_INPUT,
            "Invalid action path"
          ),
        },
        400
      );
    }

    const action = actionRegistry[actionPath];

    if (!action) {
      console.error(`Action not found: ${actionPath}`);
      return createCorsResponse(
        {
          success: false,
          error: new AppError(AppErrorCode.INVALID_INPUT, "Action not found"),
        },
        404
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
      return createCorsResponse(
        {
          success: false,
          error: new AppError(
            AppErrorCode.UNEXPECTED_ERROR,
            "Action returned undefined"
          ).toJSON(),
        },
        500
      );
    }

    // Check for server error
    if (result.serverError) {
      console.error(
        `API Route: Action ${actionPath} resulted in server error:`,
        result.serverError
      );
      return createCorsResponse(
        {
          success: false,
          error: new AppError(
            AppErrorCode.UNEXPECTED_ERROR,
            result.serverError
          ).toJSON(),
        },
        500
      );
    }

    // Check for validation error
    if (result.validationError) {
      console.warn(
        `API Route: Action ${actionPath} resulted in validation error:`,
        result.validationError
      );
      return createCorsResponse(
        {
          success: false,
          error: {
            code: AppErrorCode.VALIDATION_ERROR,
            message: "Input validation failed",
            issues: result.validationError,
          },
        },
        400
      );
    }

    // If no errors, assume success and return data
    if (result.data) {
      return createCorsResponse(result.data);
    } else {
      console.error(
        `API Route: Action ${actionPath} succeeded but returned no data.`
      );
      return createCorsResponse(
        {
          success: false,
          error: new AppError(
            AppErrorCode.UNEXPECTED_ERROR,
            "Action succeeded but returned no data"
          ).toJSON(),
        },
        500
      );
    }
  } catch (error) {
    console.error(
      `API Route: Unexpected error in POST handler for ${request.url}:`,
      error
    );
    return createCorsResponse(
      {
        success: false,
        error: new AppError(
          AppErrorCode.UNEXPECTED_ERROR,
          "Internal server error in API handler"
        ).toJSON(),
      },
      500
    );
  }
}
