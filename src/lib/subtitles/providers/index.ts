import { AppError, AppErrorCode } from "@/app/actions/actions";
import { createLogger } from "@/lib/logger";
import {
  SubtitleProvider,
  SubtitleSearchResult,
  SubtitleFetchOptions,
  SubtitleResult,
} from "./base";
import { OpenSubtitlesProvider } from "./opensubtitles";
import { SubdlProvider } from "./subdl";
import { isTargetLanguage } from "../utils";

const logger = createLogger("subtitle-provider-manager");

export class SubtitleProviderManager {
  private providers: SubtitleProvider[] = [];
  private availabilityCache = new Map<
    string,
    { isAvailable: boolean; checkedAt: number }
  >();
  private readonly cacheExpiry = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.registerProviders();
  }

  private registerProviders(): void {
    // Register providers in priority order
    this.providers = [new OpenSubtitlesProvider(), new SubdlProvider()].sort(
      (a, b) => a.priority - b.priority
    );
  }

  async searchWithFallback(
    options: SubtitleFetchOptions
  ): Promise<SubtitleSearchResult> {
    const errors: string[] = [];
    const subtitles: SubtitleResult[] = [];
    const providersWithResults = new Set<string>();

    for (const provider of this.providers) {
      try {
        // Check if provider is available (with caching)
        const isAvailable = await this.checkProviderAvailability(provider);
        if (!isAvailable) {
          errors.push(`${provider.name}: Provider not available`);
          continue;
        }

        // Attempt search
        const result = await provider.searchSubtitles(options);

        if (result.status && result.subtitles.length > 0) {
          subtitles.push(...result.subtitles);
          providersWithResults.add(provider.name);

          logger.info("provider-search-success", {
            metadata: {
              provider: provider.name,
              subtitleCount: result.subtitles.length,
              imdbID: options.imdbID,
              targetLanguage: options.targetLanguage,
            },
          });
        } else {
          errors.push(
            `${provider.name}: ${result.error || "No subtitles found"}`
          );
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        errors.push(`${provider.name}: ${errorMessage}`);

        logger.error("provider-search-error", {
          error_message: errorMessage,
          metadata: {
            provider: provider.name,
            imdbID: options.imdbID,
            targetLanguage: options.targetLanguage,
          },
        });

        // If it's a service error, mark provider as unavailable for a short time
        if (
          error instanceof AppError &&
          error.code === AppErrorCode.SERVICE_ERROR
        ) {
          this.markProviderUnavailable(provider.name);
        }
      }
    }

    const dedupedSubtitles = this.dedupeSubtitles(subtitles);
    if (dedupedSubtitles.length > 0) {
      const sortedSubtitles = this.sortSubtitlesByQuality(
        dedupedSubtitles,
        options.targetLanguage
      );
      const exactMatches = sortedSubtitles.filter((subtitle) =>
        isTargetLanguage(subtitle.language, options.targetLanguage)
      ).length;

      logger.info("provider-search-merged-success", {
        metadata: {
          providers: Array.from(providersWithResults),
          subtitleCount: sortedSubtitles.length,
          exactMatches,
          imdbID: options.imdbID,
          targetLanguage: options.targetLanguage,
        },
      });

      return {
        status: true,
        subtitles: sortedSubtitles,
        provider:
          providersWithResults.size === 1
            ? Array.from(providersWithResults)[0]
            : "multiple",
      };
    }

    logger.error("all-providers-failed", {
      error_message: "All subtitle providers failed",
      metadata: {
        errors,
        imdbID: options.imdbID,
        targetLanguage: options.targetLanguage,
      },
    });

    throw new AppError(
      AppErrorCode.RECORD_NOT_FOUND,
      `No subtitles found from any provider. Errors: ${errors.join("; ")}`
    );
  }

  private dedupeSubtitles(subtitles: SubtitleResult[]): SubtitleResult[] {
    const seen = new Set<string>();
    const deduped: SubtitleResult[] = [];

    for (const subtitle of subtitles) {
      const key = [
        subtitle.source,
        subtitle.fileId ?? "",
        subtitle.url,
        subtitle.language,
        subtitle.fileName ?? "",
      ].join("|");

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      deduped.push(subtitle);
    }

    return deduped;
  }

  private sortSubtitlesByQuality(
    subtitles: SubtitleResult[],
    targetLanguage: string
  ): SubtitleResult[] {
    const providerPriority = new Map(
      this.providers.map((provider) => [provider.name, provider.priority])
    );

    return [...subtitles].sort((a, b) => {
      return (
        this.scoreSubtitle(b, targetLanguage, providerPriority) -
        this.scoreSubtitle(a, targetLanguage, providerPriority)
      );
    });
  }

  private scoreSubtitle(
    subtitle: SubtitleResult,
    targetLanguage: string,
    providerPriority: Map<string, number>
  ): number {
    const priority = providerPriority.get(subtitle.source) ?? 99;
    let score = Math.max(0, 100 - priority * 10);

    if (isTargetLanguage(subtitle.language, targetLanguage)) score += 1000;
    if (subtitle.trusted) score += 120;
    if (subtitle.hd) score += 35;
    if (subtitle.hearingImpaired) score -= 25;
    if (subtitle.foreignPartsOnly) score -= 400;
    if (subtitle.aiTranslated || subtitle.machineTranslated) score -= 80;

    score += Math.min(subtitle.downloadCount ?? 0, 5000) / 20;
    score += Math.max(0, subtitle.rating ?? 0) * 25;

    const release = `${subtitle.release ?? ""} ${subtitle.fileName ?? ""}`;
    if (/web[-_. ]?dl|web[-_. ]?rip/i.test(release)) score += 30;
    if (/blu[-_. ]?ray|bdrip|br[-_. ]?rip/i.test(release)) score += 25;
    if (/cam|ts|telesync|hdcam/i.test(release)) score -= 100;

    return score;
  }

  async downloadFromProvider(
    providerName: string,
    fileId?: string | number,
    url?: string,
    seasonNumber?: number,
    episodeNumber?: number
  ): Promise<string> {
    const provider = this.providers.find((p) => p.name === providerName);
    if (!provider) {
      throw new AppError(
        AppErrorCode.INVALID_INPUT,
        `Provider '${providerName}' not found`
      );
    }

    try {
      const content = await provider.downloadSubtitle({
        fileId,
        url,
        seasonNumber,
        episodeNumber,
      });

      logger.info("provider-download-success", {
        metadata: {
          provider: providerName,
          contentLength: content.length,
          fileId,
          hasUrl: !!url,
        },
      });

      return content;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      logger.error("provider-download-error", {
        error_message: errorMessage,
        metadata: {
          provider: providerName,
          fileId,
          hasUrl: !!url,
        },
      });

      throw error;
    }
  }

  private async checkProviderAvailability(
    provider: SubtitleProvider
  ): Promise<boolean> {
    const cached = this.availabilityCache.get(provider.name);
    const now = Date.now();

    // Return cached result if not expired
    if (cached && now - cached.checkedAt < this.cacheExpiry) {
      return cached.isAvailable;
    }

    // Check availability
    try {
      const isAvailable = await provider.isAvailable();
      this.availabilityCache.set(provider.name, {
        isAvailable,
        checkedAt: now,
      });
      return isAvailable;
    } catch {
      this.availabilityCache.set(provider.name, {
        isAvailable: false,
        checkedAt: now,
      });
      return false;
    }
  }

  private markProviderUnavailable(providerName: string): void {
    this.availabilityCache.set(providerName, {
      isAvailable: false,
      checkedAt: Date.now(),
    });
  }

  getProviders(): SubtitleProvider[] {
    return [...this.providers];
  }
}

// Export singleton instance
export const subtitleProviderManager = new SubtitleProviderManager();

// Re-export types and classes for convenience
export * from "./base";
export { OpenSubtitlesProvider } from "./opensubtitles";
export { SubdlProvider } from "./subdl";
