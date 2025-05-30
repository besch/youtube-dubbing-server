"use server";

import { z } from "zod";
import { createSafeActionClient } from "next-safe-action";
import { ActionResponse, AppError, AppErrorCode } from "../actions";
import type { Json } from "@/types/supabase";
import { createLogger } from "@/lib/logger";
import { createServerClient } from "@supabase/ssr";
import { cookies, headers as nextHeaders } from "next/headers";
import type { Database } from "@/types/supabase";

const movieSearchLogger = createLogger("movie-search-service");

// Context interface for middleware
interface ActionContext {
  userId?: string;
  ipAddress?: string;
}

// Function to map AppErrorCode to HTTP status codes
function getStatusCodeFromAppError(code: AppErrorCode): number {
  switch (code) {
    case AppErrorCode.INVALID_INPUT:
    case AppErrorCode.VALIDATION_ERROR:
      return 400;
    case AppErrorCode.CONFIGURATION_ERROR:
      return 500; // Or a more specific client-side error if applicable
    case AppErrorCode.SERVICE_ERROR:
      return 503; // Service Unavailable or specific error from service
    // Add other specific mappings as needed
    default:
      return 500;
  }
}

// Create a new action client with middleware
const movieAction = createSafeActionClient({
  async middleware(): Promise<ActionContext> {
    const cookieStore = cookies();
    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
        },
      }
    );
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const ip =
      nextHeaders().get("x-forwarded-for") ?? nextHeaders().get("remote_addr");
    return { userId: user?.id, ipAddress: ip ?? undefined };
  },
  handleReturnedServerError(e: Error) {
    let loggedErrorCodeStr: string =
      AppErrorCode[AppErrorCode.UNEXPECTED_ERROR];
    let responseStatusCode: number = 500;
    let originalErrorCode: AppErrorCode = AppErrorCode.UNEXPECTED_ERROR;

    if (e instanceof AppError) {
      loggedErrorCodeStr = AppErrorCode[e.code];
      originalErrorCode = e.code;
      responseStatusCode = getStatusCodeFromAppError(e.code);
    }

    movieSearchLogger.error("server-error-handler", {
      error_code: loggedErrorCodeStr,
      error_message: e.message,
      stack_trace: e.stack,
      response_status_code: responseStatusCode,
    });
    return {
      serverError: e.message,
      code: originalErrorCode,
    };
  },
});

// Define the schema for input validation using Zod
const searchMoviesSchema = z.object({
  text: z.string().min(1, { message: "Search text cannot be empty" }),
  page: z.number().int().min(1).optional().default(1),
});

type SearchMoviesInput = z.infer<typeof searchMoviesSchema>;

// Define the expected structure of the OMDB API response
export interface OmdbMovie {
  Title: string;
  Year: string;
  imdbID: string;
  Type: "movie" | "series" | "episode";
  Poster: string;
}

interface OmdbSearchResponse {
  Search?: OmdbMovie[];
  totalResults?: string;
  Response: "True" | "False";
  Error?: string;
}

export const searchMovies = movieAction(
  searchMoviesSchema,
  async (
    input: SearchMoviesInput,
    { userId, ipAddress }: ActionContext
  ): Promise<
    ActionResponse<{ Search: OmdbMovie[]; totalResults: string | null }>
  > => {
    const actionStartTime = Date.now();
    const { text, page } = input;
    const apiKey = process.env.OMDB_API_KEY;
    const actionName = "search-movies-omdb";

    movieSearchLogger.info(actionName, {
      user_id: userId,
      ip_address: ipAddress,
      // request_payload: { text, page }, // Will be stripped by logger
      metadata: {
        custom_message: "Attempting to search movies on OMDB.",
        text,
        page,
      },
    });

    if (!apiKey) {
      const configError = new AppError(
        AppErrorCode.CONFIGURATION_ERROR,
        "OMDB API key is not configured."
      );
      const durationMs = Date.now() - actionStartTime;
      movieSearchLogger.error(actionName, {
        user_id: userId,
        ip_address: ipAddress,
        error_code: AppErrorCode[configError.code],
        error_message: configError.message,
        duration_ms: durationMs,
        response_status_code: getStatusCodeFromAppError(configError.code),
      });
      return { success: false, error: configError };
    }

    try {
      movieSearchLogger.debug(actionName, {
        user_id: userId,
        ip_address: ipAddress,
        metadata: { custom_message: `Searching OMDB.`, text, page },
      });

      const response = await fetch(
        `http://www.omdbapi.com/?apikey=${apiKey}&s=${encodeURIComponent(
          text
        )}&page=${page}`
      );
      // Note: duration here would be for the external API call, not the whole action yet.

      if (!response.ok) {
        const serviceError = new AppError(
          AppErrorCode.SERVICE_ERROR,
          `OMDB API request failed with status ${response.status}`
        );
        // Log duration of this attempt, not whole action yet.
        movieSearchLogger.error(actionName, {
          user_id: userId,
          ip_address: ipAddress,
          error_code: AppErrorCode[serviceError.code],
          error_message: serviceError.message,
          response_status_code: response.status, // Actual OMDB response status
          // duration_ms: undefined here, or calculate if meaningful for this sub-step
        });
        throw serviceError; // This will be caught by the outer try-catch, which calculates total duration
      }

      const data: OmdbSearchResponse = await response.json();

      if (data.Response === "False") {
        if (data.Error === "Movie not found!") {
          const durationMs = Date.now() - actionStartTime;
          movieSearchLogger.info(actionName, {
            user_id: userId,
            ip_address: ipAddress,
            duration_ms: durationMs,
            response_status_code: 200, // Action is success, though OMDB found nothing
            metadata: {
              custom_message: "OMDB: Movie not found.",
              query: text,
              page,
              omdb_response_status: data.Response,
              omdb_error_message: data.Error,
            },
          });
          return { success: true, data: { Search: [], totalResults: "0" } };
        }
        const omdbError = new AppError(
          AppErrorCode.SERVICE_ERROR,
          data.Error || "OMDB API returned an error."
        );
        // This path leads to action failure, handled by outer catch.
        throw omdbError;
      }
      const durationMs = Date.now() - actionStartTime;
      movieSearchLogger.info(actionName, {
        user_id: userId,
        ip_address: ipAddress,
        duration_ms: durationMs,
        response_status_code: 200,
        metadata: {
          custom_message: "OMDB search successful.",
          query: text,
          page,
          total_results: data.totalResults,
          received_count: data.Search?.length,
        },
        response_payload: {
          totalResults: data.totalResults,
          receivedCount: data.Search?.length,
        },
      });
      return {
        success: true,
        data: {
          Search: data.Search || [],
          totalResults: data.totalResults || null,
        },
      };
    } catch (error: unknown) {
      const durationMs = Date.now() - actionStartTime;
      const appErr =
        error instanceof AppError
          ? error
          : new AppError(
              AppErrorCode.SERVICE_ERROR,
              error instanceof Error
                ? error.message
                : "Unknown error occurred while searching movies"
            );

      movieSearchLogger.error(actionName, {
        user_id: userId,
        ip_address: ipAddress,
        error_code: AppErrorCode[appErr.code],
        error_message: appErr.message,
        stack_trace: appErr.stack,
        duration_ms: durationMs,
        response_status_code: getStatusCodeFromAppError(appErr.code),
        metadata: { rawError: String(error) },
      });
      return { success: false, error: appErr };
    }
  }
);
