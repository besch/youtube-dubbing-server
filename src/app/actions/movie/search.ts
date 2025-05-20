"use server";

import { z } from "zod";
import { createSafeActionClient } from "next-safe-action";
import { ActionResponse, AppError, AppErrorCode } from "../actions";

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

    if (!apiKey) {
      return {
        success: false,
        error: new AppError(
          AppErrorCode.CONFIGURATION_ERROR,
          "OMDB API key is not configured."
        ),
      };
    }

    try {
      console.log(`Searching OMDB for: "${text}", page: ${page}`);
      const response = await fetch(
        `http://www.omdbapi.com/?apikey=${apiKey}&s=${encodeURIComponent(
          text
        )}&page=${page}`
      );

      if (!response.ok) {
        console.error(`OMDB API error! Status: ${response.status}`);
        throw new Error(
          `OMDB API request failed with status ${response.status}`
        );
      }

      const data: OmdbSearchResponse = await response.json();

      if (data.Response === "False") {
        // Handle cases like "Movie not found!" or other OMDB errors
        console.warn(`OMDB API returned error: ${data.Error}`);
        if (data.Error === "Movie not found!") {
          // Return success with empty results for "not found"
          return { success: true, data: { Search: [], totalResults: "0" } };
        }
        // For other errors, return a failure
        return {
          success: false,
          error: new AppError(
            AppErrorCode.SERVICE_ERROR,
            data.Error || "OMDB API returned an error."
          ),
        };
      }

      console.log(
        `OMDB search successful. Found ${data.totalResults} results.`
      );
      return {
        success: true,
        data: {
          Search: data.Search || [],
          totalResults: data.totalResults || null,
        },
      };
    } catch (error: unknown) {
      console.error("Error searching movies:", error);
      const message =
        error instanceof Error ? error.message : "Unknown error occurred";
      return {
        success: false,
        error: new AppError(
          AppErrorCode.SERVICE_ERROR, // Use a generic service error code
          `Failed to search movies: ${message}`
        ),
      };
    }
  }
);
