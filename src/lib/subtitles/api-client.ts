import {
  Download,
  ErrNoMovies,
  ErrNoSubtitles,
  FetchOpenSubtitlesCom,
  FetchMovieSubtitlesOrg,
  FetchMoviesubtitlesrtCom,
  FetchPodnapisiNet,
  FetchSubdlCom,
  FetchYifySubtitlesCh,
  type DownloadOptions,
} from "./subdl";

import {
  type SubtitleOptions,
  type LanguageID,
  type DownloadedFile,
} from "./subdl/src/utils/download";

import type {
  SubdlApiResponse,
  SubtitleFetchOptions,
  SubdlSubtitle,
} from "@/types/subtitles";
import {
  getLanguageSearchStrategy,
  logSubtitleOperation,
  logSubtitleError,
} from "./utils";

// Language mapping from our system to subdl's expected language codes
const LANGUAGE_MAPPING: Record<string, LanguageID> = {
  en: "en",
  es: "es",
  fr: "fr",
  de: "de",
  it: "it",
  pt: "pt",
  ru: "ru",
  ja: "ja",
  zh: "zh",
  ko: "ko",
  ar: "ar",
  hi: "hi",
  nl: "nl",
  sv: "sv",
  no: "no",
  da: "da",
  fi: "fi",
  pl: "pl",
  tr: "tr",
  he: "he",
};

export class SubdlApiClient {
  private readonly fetchers = [
    FetchSubdlCom,
    FetchOpenSubtitlesCom,
    FetchMovieSubtitlesOrg,
    FetchMoviesubtitlesrtCom,
    FetchPodnapisiNet,
    FetchYifySubtitlesCh,
  ];

  async fetchSubtitles(
    options: SubtitleFetchOptions
  ): Promise<SubdlApiResponse> {
    const { imdbID, title, year, targetLanguage, seasonNumber, episodeNumber } =
      options;

    logSubtitleOperation("API_Fetch", {
      imdbID,
      title,
      year,
      targetLanguage,
      hasEpisode: seasonNumber !== undefined && episodeNumber !== undefined,
    });

    // Use movie title and year for better search results
    const movieQuery = await this.buildMovieQuery(
      title,
      year,
      seasonNumber,
      episodeNumber
    );

    logSubtitleOperation("API_MovieQuery", {
      imdbID,
      title,
      year,
      movieQuery,
      targetLanguage,
    });

    const strategy = getLanguageSearchStrategy(targetLanguage);

    // Try each language strategy
    const languageStrategies = [
      { languages: strategy.primary, step: "primary" },
      { languages: strategy.fallback, step: "fallback" },
      { languages: strategy.lastResort, step: "last_resort" },
    ];

    for (const { languages, step } of languageStrategies) {
      logSubtitleOperation("API_Strategy", {
        imdbID,
        title,
        step,
        searchLanguages: languages,
      });

      const languageList = languages.split(",").map((lang) => lang.trim());

      for (const language of languageList) {
        // Skip if we don't have a mapping for this language
        if (!LANGUAGE_MAPPING[language]) {
          logSubtitleOperation("API_LanguageSkipped", {
            language,
            reason: "No mapping available",
          });
          continue;
        }

        const subtitles = await this.tryFetchFromAllSources(
          movieQuery,
          language
        );

        if (subtitles.length > 0) {
          logSubtitleOperation("API_Strategy_Success", {
            step,
            language,
            subtitleCount: subtitles.length,
          });

          return {
            status: true,
            subtitles: subtitles,
          };
        }
      }
    }

    logSubtitleOperation("API_Strategy_Final", {
      step: "all_failed",
      subtitleCount: 0,
      success: false,
    });

    return {
      status: false,
      subtitles: [],
      message: "No subtitles found after trying all sources and languages",
    };
  }

  private async buildMovieQuery(
    title: string,
    year?: string,
    seasonNumber?: number,
    episodeNumber?: number
  ): Promise<string> {
    // Use movie title as the primary search query
    let query = title.trim();

    // Add year for more precise matching if available
    if (year) {
      query += ` ${year}`;
    }

    // For episodes, add season and episode information
    if (seasonNumber !== undefined && episodeNumber !== undefined) {
      // Try different episode formats that might work better
      const episodeFormats = [
        `S${String(seasonNumber).padStart(2, "0")}E${String(
          episodeNumber
        ).padStart(2, "0")}`,
        `Season ${seasonNumber} Episode ${episodeNumber}`,
        `${seasonNumber}x${String(episodeNumber).padStart(2, "0")}`,
      ];

      // Use the most common format first
      query += ` ${episodeFormats[0]}`;
    }

    logSubtitleOperation("API_QueryBuilt", {
      originalTitle: title,
      year,
      seasonNumber,
      episodeNumber,
      finalQuery: query,
    });

    return query;
  }

  private async tryFetchFromAllSources(
    movieQuery: string,
    language: string
  ): Promise<SubdlSubtitle[]> {
    const mappedLanguage = LANGUAGE_MAPPING[language];
    if (!mappedLanguage) {
      logSubtitleOperation("API_LanguageMappingFailed", {
        originalLanguage: language,
        availableMappings: Object.keys(LANGUAGE_MAPPING),
      });
      return [];
    }

    const subtitleOptions: SubtitleOptions = {
      language: mappedLanguage,
    };

    const downloadOptions: DownloadOptions = {
      movieListQuery: movieQuery,
      movieListSorter: {},
      subtitleListQuery: "",
      subtitleListSorter: {},
    };

    const allSubtitles: SubdlSubtitle[] = [];

    for (const fetcher of this.fetchers) {
      try {
        logSubtitleOperation("API_SourceAttempt", {
          source: fetcher.name,
          movieQuery,
          language: mappedLanguage,
        });

        const downloadedFile: DownloadedFile = await Download(
          movieQuery,
          subtitleOptions,
          fetcher,
          downloadOptions
        );

        if (downloadedFile.subtitles && downloadedFile.subtitles.length > 0) {
          logSubtitleOperation("API_SourceDownloadSuccess", {
            source: fetcher.name,
            subtitleCount: downloadedFile.subtitles.length,
            filenames: downloadedFile.subtitles
              .map((s) => s.filename)
              .join(", "),
          });

          // Convert subdl format to our expected format
          downloadedFile.subtitles.forEach(
            (subtitleFileContent, index: number) => {
              if (
                subtitleFileContent.subtitles &&
                subtitleFileContent.subtitles.trim()
              ) {
                allSubtitles.push({
                  url: `data:text/srt;base64,${Buffer.from(
                    subtitleFileContent.subtitles
                  ).toString("base64")}`,
                  language: language,
                  file_name:
                    subtitleFileContent.filename || `subtitle_${index}.srt`,
                  author: "subdl",
                  comment: `Downloaded from ${fetcher.name}`,
                  rating: 0,
                  download_count: 0,
                  release_name: subtitleFileContent.filename || "",
                  fps: 0,
                  cd_count: 1,
                  hi: false,
                });
              }
            }
          );

          logSubtitleOperation("API_SourceSuccess", {
            source: fetcher.name,
            subtitleCount: allSubtitles.length,
          });
        } else {
          logSubtitleOperation("API_SourceEmptyResult", {
            source: fetcher.name,
            movieQuery,
            language: mappedLanguage,
          });
        }
      } catch (error) {
        if (error === ErrNoMovies) {
          logSubtitleOperation("API_SourceNoMovies", {
            source: fetcher.name,
            movieQuery,
            language: mappedLanguage,
          });
        } else if (error === ErrNoSubtitles) {
          logSubtitleOperation("API_SourceNoSubtitles", {
            source: fetcher.name,
            movieQuery,
            language: mappedLanguage,
          });
        } else {
          logSubtitleError("API_SourceError", error, {
            source: fetcher.name,
            movieQuery,
            language: mappedLanguage,
            errorMessage:
              error instanceof Error ? error.message : String(error),
          });
        }
        // Continue to next source
      }
    }

    logSubtitleOperation("API_SourceSummary", {
      movieQuery,
      language: mappedLanguage,
      totalSubtitlesFound: allSubtitles.length,
      sourcesAttempted: this.fetchers.length,
    });

    return allSubtitles;
  }
}
