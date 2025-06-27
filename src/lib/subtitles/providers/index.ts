import { AppError, AppErrorCode } from "@/app/actions/actions";
import { createLogger } from "@/lib/logger";
import {
  SubtitleProvider,
  SubtitleSearchResult,
  SubtitleFetchOptions,
} from "./base";
import { OpenSubtitlesProvider } from "./opensubtitles";
import { SubdlProvider } from "./subdl";

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
          // Success! Log and return
          logger.info("provider-search-success", {
            metadata: {
              provider: provider.name,
              subtitleCount: result.subtitles.length,
              imdbID: options.imdbID,
              targetLanguage: options.targetLanguage,
            },
          });
          return result;
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

    // All providers failed
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

  async downloadFromProvider(
    providerName: string,
    fileId?: string | number,
    url?: string
  ): Promise<string> {
    const provider = this.providers.find((p) => p.name === providerName);
    if (!provider) {
      throw new AppError(
        AppErrorCode.INVALID_INPUT,
        `Provider '${providerName}' not found`
      );
    }

    try {
      const content = await provider.downloadSubtitle({ fileId, url });

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
