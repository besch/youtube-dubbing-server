"use server";

import { z } from "zod";
import { createSafeActionClient } from "next-safe-action";
import { ActionResponse, AppError, AppErrorCode } from "../actions";
import type { Json } from "@/types/supabase";
import { createLogger } from "@/lib/logger";

const movieSearchLogger = createLogger("movie-search-service");

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

// Create the safe action using createSafeActionClient and the schema
export const searchMovies = createSafeActionClient()(
  searchMoviesSchema,
  async (
    input: SearchMoviesInput
  ): Promise<
    ActionResponse<{ Search: OmdbMovie[]; totalResults: string | null }>
  > => {
    const { text, page } = input;
    const apiKey = process.env.OMDB_API_KEY;
    const actionName = "search-movies-omdb";

    movieSearchLogger.info(actionName, {
      request_payload: { text, page },
      metadata: { custom_message: "Attempting to search movies on OMDB." },
    });

    if (!apiKey) {
      const configError = new AppError(
        AppErrorCode.CONFIGURATION_ERROR,
        "OMDB API key is not configured."
      );
      movieSearchLogger.error(actionName, {
        error_code: AppErrorCode[configError.code],
        error_message: configError.message,
        request_payload: { text, page },
      });
      return {
        success: false,
        error: configError,
      };
    }

    try {
      movieSearchLogger.debug(actionName, {
        metadata: { custom_message: `Searching OMDB.`, text, page },
      });

      const response = await fetch(
        `http://www.omdbapi.com/?apikey=${apiKey}&s=${encodeURIComponent(
          text
        )}&page=${page}`
      );

      if (!response.ok) {
        const serviceError = new AppError(
          AppErrorCode.SERVICE_ERROR,
          `OMDB API request failed with status ${response.status}`
        );
        movieSearchLogger.error(actionName, {
          error_code: AppErrorCode[serviceError.code],
          error_message: serviceError.message,
          response_status_code: response.status,
          request_payload: { text, page },
        });
        throw serviceError;
      }

      const data: OmdbSearchResponse = await response.json();

      if (data.Response === "False") {
        if (data.Error === "Movie not found!") {
          movieSearchLogger.info(actionName, {
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
        movieSearchLogger.warn(actionName, {
          error_code: AppErrorCode[omdbError.code],
          error_message: omdbError.message,
          request_payload: { text, page },
          metadata: {
            omdb_response_status: data.Response,
            omdb_error_message: data.Error,
          },
        });
        return {
          success: false,
          error: omdbError,
        };
      }

      movieSearchLogger.info(actionName, {
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
        error_code: AppErrorCode[appErr.code],
        error_message: appErr.message,
        request_payload: { text, page },
        stack_trace: appErr.stack,
        metadata: { rawError: String(error) },
      });
      return {
        success: false,
        error: appErr,
      };
    }
  }
);
