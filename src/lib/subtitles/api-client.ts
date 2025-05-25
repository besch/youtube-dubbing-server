import fetch from "node-fetch";

import { AppError, AppErrorCode } from "@/app/actions/actions";
import type { SubdlApiResponse, SubtitleFetchOptions } from "@/types/subtitles";
import { getSubdlConfig, SUBTITLE_CONFIG } from "./config";
import {
  getLanguageSearchStrategy,
  buildSubdlUrl,
  createRetryDelay,
  logSubtitleOperation,
  logSubtitleError,
} from "./utils";

export class SubdlApiClient {
  private readonly config = getSubdlConfig();

  async fetchSubtitles(
    options: SubtitleFetchOptions
  ): Promise<SubdlApiResponse> {
    const { imdbID, targetLanguage, seasonNumber, episodeNumber } = options;

    logSubtitleOperation("API_Fetch", {
      imdbID,
      targetLanguage,
      hasEpisode: seasonNumber !== undefined && episodeNumber !== undefined,
    });

    const strategy = getLanguageSearchStrategy(targetLanguage);

    // Step 1: Try target language only
    logSubtitleOperation("API_Strategy_Primary", {
      imdbID,
      targetLanguage,
      searchLanguages: strategy.primary,
    });

    let response = await this.querySubdlApi(
      imdbID,
      strategy.primary,
      seasonNumber,
      episodeNumber
    );

    if (
      response.status &&
      response.subtitles &&
      response.subtitles.length > 0
    ) {
      logSubtitleOperation("API_Strategy_Success", {
        step: "primary",
        subtitleCount: response.subtitles.length,
      });
      return response;
    }

    // Step 2: Try common languages (good for translation)
    logSubtitleOperation("API_Strategy_Fallback", {
      imdbID,
      searchLanguages: strategy.fallback,
    });

    response = await this.querySubdlApi(
      imdbID,
      strategy.fallback,
      seasonNumber,
      episodeNumber
    );

    if (
      response.status &&
      response.subtitles &&
      response.subtitles.length > 0
    ) {
      logSubtitleOperation("API_Strategy_Success", {
        step: "fallback",
        subtitleCount: response.subtitles.length,
      });
      return response;
    }

    // Step 3: Last resort - try all languages
    logSubtitleOperation("API_Strategy_LastResort", {
      imdbID,
      searchLanguages: "all_supported_languages",
    });

    response = await this.querySubdlApi(
      imdbID,
      strategy.lastResort,
      seasonNumber,
      episodeNumber
    );

    logSubtitleOperation("API_Strategy_Final", {
      step: "last_resort",
      subtitleCount: response.subtitles?.length || 0,
      success: response.status,
    });

    return response;
  }

  private async querySubdlApi(
    imdbID: string,
    languages: string,
    seasonNumber?: number,
    episodeNumber?: number
  ): Promise<SubdlApiResponse> {
    const url = buildSubdlUrl(
      this.config.baseUrl,
      this.config.apiKey,
      imdbID,
      languages,
      seasonNumber,
      episodeNumber
    );

    return await this.makeApiRequest(url);
  }

  private async makeApiRequest(url: string): Promise<SubdlApiResponse> {
    let lastError: unknown;

    for (let attempt = 0; attempt < SUBTITLE_CONFIG.maxRetries; attempt++) {
      try {
        logSubtitleOperation("API_Request", { url, attempt: attempt + 1 });

        const response = await fetch(url, {
          timeout: SUBTITLE_CONFIG.downloadTimeout,
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; SubtitleDownloader/1.0)",
          },
        });

        if (!response.ok) {
          throw new AppError(
            AppErrorCode.SERVICE_ERROR,
            `Subdl API request failed: HTTP ${response.status} ${response.statusText}`
          );
        }

        const rawData = (await response.json()) as any;

        // Normalize the response structure
        const normalizedData: SubdlApiResponse = {
          status: rawData.status || rawData.success || false,
          subtitles: rawData.subtitles || rawData.results || [],
          totalPages: rawData.totalPages,
          currentPage: rawData.currentPage,
          message: rawData.message,
          error: rawData.error,
        };

        // Debug: Log what we got before filtering
        logSubtitleOperation("API_RawResponse", {
          url,
          totalSubtitles: normalizedData.subtitles.length,
          sampleSubtitles: normalizedData.subtitles.slice(0, 3).map((sub) => ({
            url: sub.url,
            language: sub.language,
            file_name: sub.file_name,
          })),
        });

        // Filter to only include SRT format subtitles - be more permissive
        const originalCount = normalizedData.subtitles.length;
        normalizedData.subtitles = normalizedData.subtitles.filter(
          (subtitle) => {
            if (!subtitle.url) return false;

            const url = subtitle.url.toLowerCase();
            const fileName = subtitle.file_name?.toLowerCase() || "";

            // Be more permissive - most subtitle downloads are SRT even if not explicitly stated
            // Only exclude if we know it's definitely not SRT (like .vtt, .ass, .sub)
            const isExplicitlyNotSrt =
              url.includes(".vtt") ||
              url.includes(".ass") ||
              url.includes(".sub") ||
              fileName.endsWith(".vtt") ||
              fileName.endsWith(".ass") ||
              fileName.endsWith(".sub");

            return !isExplicitlyNotSrt;
          }
        );

        logSubtitleOperation("API_Success", {
          url,
          originalCount,
          filteredCount: normalizedData.subtitles.length,
          status: normalizedData.status,
        });

        return normalizedData;
      } catch (error) {
        lastError = error;
        logSubtitleError("API_Request", error, { url, attempt: attempt + 1 });

        // Don't retry on certain errors
        if (
          error instanceof AppError &&
          error.code === AppErrorCode.SERVICE_ERROR
        ) {
          const response = error.message;
          if (
            response.includes("404") ||
            response.includes("401") ||
            response.includes("403")
          ) {
            break;
          }
        }

        // Wait before retrying (except on last attempt)
        if (attempt < SUBTITLE_CONFIG.maxRetries - 1) {
          const delay = createRetryDelay(attempt);
          logSubtitleOperation("API_Retry", {
            url,
            delay,
            nextAttempt: attempt + 2,
          });
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // All retries failed
    throw new AppError(
      AppErrorCode.SERVICE_ERROR,
      `Subdl API request failed after ${SUBTITLE_CONFIG.maxRetries} attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }
}
