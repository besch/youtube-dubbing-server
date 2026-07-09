import { AppError, AppErrorCode } from "@/app/actions/actions";
import { SubdlApiClient } from "../api-client";
import { downloadAndExtractSubtitle } from "../downloader";
import {
  SubtitleProvider,
  SubtitleSearchResult,
  SubtitleFetchOptions,
  SubtitleDownloadOptions,
  SubtitleResult,
} from "./base";

export class SubdlProvider implements SubtitleProvider {
  readonly name = "subdl";
  readonly priority = 2; // Lower priority than OpenSubtitles

  private apiClient = new SubdlApiClient();

  async isAvailable(): Promise<boolean> {
    try {
      // Test with a known movie to check if Subdl is working
      const testResponse = await this.apiClient.fetchSubtitles({
        imdbID: "tt0111161", // The Shawshank Redemption
        targetLanguage: "en",
      });
      return testResponse.status === true;
    } catch {
      return false;
    }
  }

  async searchSubtitles(
    options: SubtitleFetchOptions
  ): Promise<SubtitleSearchResult> {
    try {
      const apiResponse = await this.apiClient.fetchSubtitles({
        imdbID: options.imdbID,
        targetLanguage: options.targetLanguage,
        seasonNumber: options.seasonNumber,
        episodeNumber: options.episodeNumber,
      });

      if (!apiResponse.status || !apiResponse.subtitles) {
        return {
          status: false,
          subtitles: [],
          error: apiResponse.error || "No subtitles found",
          provider: this.name,
        };
      }

      // Convert Subdl format to common format
      const subtitles: SubtitleResult[] = apiResponse.subtitles.map(
        (subtitle) => ({
          url: subtitle.url,
          language: subtitle.language,
          fileName: subtitle.file_name,
          downloadCount: subtitle.download_count,
          rating: subtitle.rating,
          hearingImpaired: subtitle.hi,
          release: subtitle.release_name,
          source: this.name,
        })
      );

      return {
        status: true,
        subtitles,
        provider: this.name,
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      return {
        status: false,
        subtitles: [],
        error: error instanceof Error ? error.message : String(error),
        provider: this.name,
      };
    }
  }

  async downloadSubtitle(options: SubtitleDownloadOptions): Promise<string> {
    try {
      if (!options.url) {
        throw new AppError(
          AppErrorCode.INVALID_INPUT,
          "URL is required for Subdl download"
        );
      }

      // Use the existing downloader which handles extraction and formatting
      const content = await downloadAndExtractSubtitle(
        options.url,
        options.seasonNumber,
        options.episodeNumber
      );
      return content;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        AppErrorCode.SERVICE_ERROR,
        `Failed to download subtitle from Subdl: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
