import { AppError, AppErrorCode } from "@/app/actions/actions";
import type {
  SubtitleDownloadResult,
  SubtitleFetchOptions,
} from "@/types/subtitles";
import { translateSubtitles } from "@/lib/subtitles";

import { SubdlApiClient } from "./api-client";
import { downloadAndExtractSubtitle } from "./downloader";
import {
  insertNewLineIfWrongFormattedSRT,
  isTargetLanguage,
  logSubtitleOperation,
  logSubtitleError,
} from "./utils";

export class SubtitleService {
  private readonly apiClient = new SubdlApiClient();

  async getOrGenerateSubtitles(
    options: SubtitleFetchOptions
  ): Promise<SubtitleDownloadResult> {
    const { imdbID, targetLanguage, seasonNumber, episodeNumber } = options;

    logSubtitleOperation("Service_Start", {
      imdbID,
      targetLanguage,
      hasEpisode: seasonNumber !== undefined && episodeNumber !== undefined,
    });

    try {
      const apiResponse = await this.apiClient.fetchSubtitles(options);

      if (
        !apiResponse.status ||
        !apiResponse.subtitles ||
        apiResponse.subtitles.length === 0
      ) {
        throw new AppError(
          AppErrorCode.RECORD_NOT_FOUND,
          "No SRT subtitles found for the given content after checking all available sources."
        );
      }

      // Try to get direct match in target language first
      const directMatch = await this.tryDirectLanguageMatch(
        apiResponse.subtitles,
        targetLanguage,
        seasonNumber,
        episodeNumber
      );

      if (directMatch) {
        logSubtitleOperation("Service_DirectMatch", {
          imdbID,
          targetLanguage,
          sourceLanguage: targetLanguage,
        });
        return directMatch;
      }

      // Fall back to translation from best available subtitle
      const translatedResult = await this.translateFromBestAvailable(
        apiResponse.subtitles,
        targetLanguage,
        seasonNumber,
        episodeNumber
      );

      logSubtitleOperation("Service_Translated", {
        imdbID,
        targetLanguage,
        sourceLanguage: translatedResult.sourceLanguage,
      });

      return translatedResult;
    } catch (error) {
      logSubtitleError("Service_Error", error, { imdbID, targetLanguage });

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        AppErrorCode.UNEXPECTED_ERROR,
        `Failed to get or generate subtitles: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async tryDirectLanguageMatch(
    subtitles: Array<{ url: string; language: string }>,
    targetLanguage: string,
    seasonNumber?: number,
    episodeNumber?: number
  ): Promise<SubtitleDownloadResult | null> {
    const targetLanguageSubtitles = subtitles.filter((sub) =>
      isTargetLanguage(sub.language, targetLanguage)
    );

    if (targetLanguageSubtitles.length === 0) {
      return null;
    }

    logSubtitleOperation("DirectMatch_Attempt", {
      targetLanguage,
      candidateCount: targetLanguageSubtitles.length,
    });

    // Try each subtitle until one works
    for (const subtitle of targetLanguageSubtitles) {
      try {
        let content = await downloadAndExtractSubtitle(
          subtitle.url,
          seasonNumber,
          episodeNumber
        );

        content = insertNewLineIfWrongFormattedSRT(content);

        logSubtitleOperation("DirectMatch_Success", {
          targetLanguage,
          url: subtitle.url,
          contentLength: content.length,
        });

        return {
          content,
          generated: false,
          sourceLanguage: targetLanguage,
        };
      } catch (error) {
        logSubtitleError("DirectMatch_Failed", error, {
          targetLanguage,
          url: subtitle.url,
        });
        // Continue to next subtitle
      }
    }

    logSubtitleOperation("DirectMatch_AllFailed", {
      targetLanguage,
      attemptedCount: targetLanguageSubtitles.length,
    });

    return null;
  }

  private async translateFromBestAvailable(
    subtitles: Array<{ url: string; language: string }>,
    targetLanguage: string,
    seasonNumber?: number,
    episodeNumber?: number
  ): Promise<SubtitleDownloadResult> {
    // Use the first available subtitle (API returns them in priority order)
    const bestSubtitle = subtitles[0];

    logSubtitleOperation("Translation_Start", {
      targetLanguage,
      sourceLanguage: bestSubtitle.language,
      url: bestSubtitle.url,
    });

    let content = await downloadAndExtractSubtitle(
      bestSubtitle.url,
      seasonNumber,
      episodeNumber
    );

    content = insertNewLineIfWrongFormattedSRT(content);

    // If source is already target language, return as-is
    if (isTargetLanguage(bestSubtitle.language, targetLanguage)) {
      return {
        content,
        generated: false,
        sourceLanguage: bestSubtitle.language,
      };
    }

    // Translate the content
    const translatedContent = await translateSubtitles(
      content,
      bestSubtitle.language,
      targetLanguage
    );

    return {
      content: translatedContent,
      generated: true,
      sourceLanguage: bestSubtitle.language,
    };
  }
}

// Export singleton instance
export const subtitleService = new SubtitleService();
