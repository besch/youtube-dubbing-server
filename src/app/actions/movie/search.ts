"use server";

import { z } from "zod";
import { createSafeActionClient } from "next-safe-action";
import { ActionResponse, AppError, AppErrorCode } from "../actions";
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

// TMDb API response structures
interface TMDbMovie {
  id: number;
  title?: string; // For movies
  name?: string; // For TV shows
  release_date?: string; // For movies
  first_air_date?: string; // For TV shows
  poster_path?: string | null;
  media_type?: "movie" | "tv" | "person";
  overview?: string;
  vote_average?: number;
  genre_ids?: number[];
}

interface TMDbSearchResponse {
  page: number;
  results: TMDbMovie[];
  total_pages: number;
  total_results: number;
}

// Interface matching the expected frontend format (keeping OMDB structure for compatibility)
export interface OmdbMovie {
  Title: string;
  Year: string;
  imdbID: string;
  Type: "movie" | "series" | "episode";
  Poster: string;
}

// Function to convert TMDb movie to OMDB-compatible format
function convertTMDbToOmdbFormat(tmdbMovie: TMDbMovie): OmdbMovie {
  const title = tmdbMovie.title || tmdbMovie.name || "Unknown Title";
  const year = tmdbMovie.release_date
    ? tmdbMovie.release_date.split("-")[0]
    : tmdbMovie.first_air_date
    ? tmdbMovie.first_air_date.split("-")[0]
    : "N/A";

  // Generate a pseudo-IMDB ID using TMDb ID (prefixed with 'tm' for TMDb)
  const imdbID = `tm${tmdbMovie.id}`;

  // Determine type based on media_type or presence of certain fields
  let type: "movie" | "series" | "episode" = "movie";
  if (tmdbMovie.media_type === "tv" || tmdbMovie.name) {
    type = "series";
  }

  const poster = tmdbMovie.poster_path
    ? `https://image.tmdb.org/t/p/w500${tmdbMovie.poster_path}`
    : "N/A";

  return {
    Title: title,
    Year: year,
    imdbID: imdbID,
    Type: type,
    Poster: poster,
  };
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
    const apiKey = process.env.TMDB_API_KEY;
    const actionName = "search-movies-tmdb";

    movieSearchLogger.info(actionName, {
      user_id: userId,
      ip_address: ipAddress,
      request_payload: { text, page },
      metadata: {
        custom_message: "Attempting to search movies on TMDb.",
      },
    });

    if (!apiKey) {
      const configError = new AppError(
        AppErrorCode.CONFIGURATION_ERROR,
        "TMDb API key is not configured."
      );
      const durationMs = Date.now() - actionStartTime;
      movieSearchLogger.error(actionName, {
        user_id: userId,
        ip_address: ipAddress,
        request_payload: { text, page },
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
        request_payload: { text, page },
        metadata: { custom_message: `Searching TMDb.` },
      });

      // TMDb multi-search endpoint to search both movies and TV shows
      const response = await fetch(
        `https://api.themoviedb.org/3/search/multi?api_key=${apiKey}&query=${encodeURIComponent(
          text
        )}&page=${page}&include_adult=false`
      );

      if (!response.ok) {
        const serviceError = new AppError(
          AppErrorCode.SERVICE_ERROR,
          `TMDb API request failed with status ${response.status}`
        );
        movieSearchLogger.error(actionName, {
          user_id: userId,
          ip_address: ipAddress,
          request_payload: { text, page },
          error_code: AppErrorCode[serviceError.code],
          error_message: serviceError.message,
          response_status_code: response.status,
        });
        throw serviceError;
      }

      const data: TMDbSearchResponse = await response.json();

      // Filter out person results and convert to OMDB format
      const movieResults = data.results
        .filter(
          (item) => item.media_type === "movie" || item.media_type === "tv"
        )
        .map(convertTMDbToOmdbFormat);

      const durationMs = Date.now() - actionStartTime;
      movieSearchLogger.info(actionName, {
        user_id: userId,
        ip_address: ipAddress,
        request_payload: { text, page },
        duration_ms: durationMs,
        response_status_code: 200,
        metadata: {
          custom_message: "TMDb search successful.",
          total_results: data.total_results.toString(),
          received_count: movieResults.length,
          total_pages: data.total_pages,
        },
        response_payload: {
          totalResults: data.total_results.toString(),
          receivedCount: movieResults.length,
        },
      });

      return {
        success: true,
        data: {
          Search: movieResults,
          totalResults: data.total_results.toString(),
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
        request_payload: { text, page },
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
