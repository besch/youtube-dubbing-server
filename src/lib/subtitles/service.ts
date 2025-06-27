import { AppError, AppErrorCode } from "@/app/actions/actions";
import type {
  SubtitleDownloadResult,
  SubtitleFetchOptions,
} from "@/types/subtitles";
import { translateSubtitles } from "./translate";
import { subtitleQualityValidator } from "./quality-validator";
import {
  insertNewLineIfWrongFormattedSRT,
  isTargetLanguage,
  logSubtitleOperation,
  logSubtitleError,
} from "./utils";
import { subtitleProviderManager } from "./providers";

export class SubtitleService {
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
      // Use the new provider system with fallback
      const searchResult = await subtitleProviderManager.searchWithFallback({
        imdbID,
        targetLanguage,
        seasonNumber,
        episodeNumber,
      });

      if (
        !searchResult.status ||
        !searchResult.subtitles ||
        searchResult.subtitles.length === 0
      ) {
        throw new AppError(
          AppErrorCode.RECORD_NOT_FOUND,
          "No SRT subtitles found for the given content after checking all available sources."
        );
      }

      // Try to get direct match in target language first
      const directMatch = await this.tryDirectLanguageMatch(
        searchResult.subtitles,
        searchResult.provider,
        targetLanguage,
        seasonNumber,
        episodeNumber
      );

      if (directMatch) {
        logSubtitleOperation("Service_DirectMatch", {
          imdbID,
          targetLanguage,
          sourceLanguage: targetLanguage,
          provider: searchResult.provider,
        });
        return directMatch;
      }

      // Fall back to translation from best available subtitle
      const translatedResult = await this.translateFromBestAvailable(
        searchResult.subtitles,
        searchResult.provider,
        targetLanguage,
        seasonNumber,
        episodeNumber
      );

      logSubtitleOperation("Service_Translated", {
        imdbID,
        targetLanguage,
        sourceLanguage: translatedResult.sourceLanguage,
        provider: searchResult.provider,
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
    subtitles: Array<{
      url: string;
      language: string;
      fileId?: string | number;
      source: string;
    }>,
    provider: string,
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
      provider,
    });

    // Try each subtitle until one works and passes quality validation
    for (const subtitle of targetLanguageSubtitles) {
      try {
        // Download using the appropriate provider
        let content = await subtitleProviderManager.downloadFromProvider(
          subtitle.source,
          subtitle.fileId,
          subtitle.url
        );

        content = insertNewLineIfWrongFormattedSRT(content);

        // Validate subtitle quality using Google Gemini
        const qualityResult =
          await subtitleQualityValidator.validateSubtitleQuality({
            content,
            expectedLanguage: targetLanguage,
          });

        logSubtitleOperation("DirectMatch_QualityCheck", {
          targetLanguage,
          url: subtitle.url,
          isValid: qualityResult.isValid,
          detectedLanguage: qualityResult.detectedLanguage,
          confidence: qualityResult.confidence,
          issueCount: qualityResult.issues.length,
          provider,
        });

        if (!qualityResult.isValid) {
          logSubtitleOperation("DirectMatch_QualityFailed", {
            targetLanguage,
            url: subtitle.url,
            detectedLanguage: qualityResult.detectedLanguage,
            issues: qualityResult.issues,
            reason: qualityResult.reason,
            provider,
          });
          // Continue to next subtitle
          continue;
        }

        logSubtitleOperation("DirectMatch_Success", {
          targetLanguage,
          url: subtitle.url,
          contentLength: content.length,
          detectedLanguage: qualityResult.detectedLanguage,
          confidence: qualityResult.confidence,
          provider,
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
          provider,
        });
        // Continue to next subtitle
      }
    }

    logSubtitleOperation("DirectMatch_AllFailed", {
      targetLanguage,
      attemptedCount: targetLanguageSubtitles.length,
      provider,
    });

    return null;
  }

  private async translateFromBestAvailable(
    subtitles: Array<{
      url: string;
      language: string;
      fileId?: string | number;
      source: string;
    }>,
    provider: string,
    targetLanguage: string,
    seasonNumber?: number,
    episodeNumber?: number
  ): Promise<SubtitleDownloadResult> {
    // Try subtitles in order until we find one with good quality
    for (let i = 0; i < subtitles.length; i++) {
      const subtitle = subtitles[i];

      logSubtitleOperation("Translation_Attempt", {
        targetLanguage,
        sourceLanguage: subtitle.language,
        url: subtitle.url,
        attemptNumber: i + 1,
        totalCandidates: subtitles.length,
        provider,
      });

      try {
        // Download using the appropriate provider
        let content = await subtitleProviderManager.downloadFromProvider(
          subtitle.source,
          subtitle.fileId,
          subtitle.url
        );

        content = insertNewLineIfWrongFormattedSRT(content);

        // Validate source subtitle quality
        const qualityResult =
          await subtitleQualityValidator.validateSubtitleQuality({
            content,
            expectedLanguage: subtitle.language,
          });

        logSubtitleOperation("Translation_QualityCheck", {
          targetLanguage,
          sourceLanguage: subtitle.language,
          url: subtitle.url,
          isValid: qualityResult.isValid,
          detectedLanguage: qualityResult.detectedLanguage,
          confidence: qualityResult.confidence,
          issueCount: qualityResult.issues.length,
          provider,
        });

        if (!qualityResult.isValid) {
          logSubtitleOperation("Translation_QualityFailed", {
            targetLanguage,
            sourceLanguage: subtitle.language,
            url: subtitle.url,
            detectedLanguage: qualityResult.detectedLanguage,
            issues: qualityResult.issues,
            reason: qualityResult.reason,
            provider,
          });
          // Try next subtitle if available
          if (i < subtitles.length - 1) {
            continue;
          } else {
            // This is the last subtitle, proceed anyway with a warning
            logSubtitleOperation("Translation_LastResort", {
              targetLanguage,
              sourceLanguage: subtitle.language,
              url: subtitle.url,
              message:
                "Using subtitle despite quality issues as it's the last available option",
              provider,
            });
          }
        }

        // If source is already target language, return as-is
        if (isTargetLanguage(subtitle.language, targetLanguage)) {
          logSubtitleOperation("Translation_DirectMatch", {
            targetLanguage,
            sourceLanguage: subtitle.language,
            detectedLanguage: qualityResult.detectedLanguage,
            confidence: qualityResult.confidence,
            provider,
          });

          return {
            content,
            generated: false,
            sourceLanguage: subtitle.language,
          };
        }

        // Translate the content
        const translatedContent = await translateSubtitles(
          content,
          subtitle.language,
          targetLanguage
        );

        logSubtitleOperation("Translation_Success", {
          targetLanguage,
          sourceLanguage: subtitle.language,
          detectedLanguage: qualityResult.detectedLanguage,
          confidence: qualityResult.confidence,
          originalLength: content.length,
          translatedLength: translatedContent.length,
          provider,
        });

        return {
          content: translatedContent,
          generated: true,
          sourceLanguage: subtitle.language,
        };
      } catch (error) {
        logSubtitleError("Translation_Failed", error, {
          targetLanguage,
          sourceLanguage: subtitle.language,
          url: subtitle.url,
          attemptNumber: i + 1,
          provider,
        });

        // If this is the last subtitle, throw the error
        if (i === subtitles.length - 1) {
          throw error;
        }
        // Otherwise, continue to next subtitle
      }
    }

    // This should never be reached, but just in case
    throw new AppError(
      AppErrorCode.RECORD_NOT_FOUND,
      "No suitable subtitles found after quality validation"
    );
  }
}

// Export singleton instance
export const subtitleService = new SubtitleService();
