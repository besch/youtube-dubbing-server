import { AppError, AppErrorCode } from "@/app/actions/actions";
import { getLanguageSearchStrategy } from "../utils";
import {
  SubtitleProvider,
  SubtitleSearchResult,
  SubtitleFetchOptions,
  SubtitleDownloadOptions,
  SubtitleResult,
} from "./base";

interface OpenSubtitlesConfig {
  apiKey: string;
  username?: string;
  password?: string;
  userAgent: string;
  baseUrl: string;
}

interface OpenSubtitlesSearchResponse {
  total_pages: number;
  total_count: number;
  per_page: number;
  page: number;
  data: OpenSubtitlesSubtitle[];
}

interface OpenSubtitlesSubtitle {
  id: string;
  type: string;
  attributes: {
    subtitle_id: string;
    language: string;
    download_count: number;
    new_download_count: number;
    hearing_impaired: boolean;
    hd: boolean;
    fps: number;
    votes: number;
    ratings: number;
    from_trusted: boolean;
    foreign_parts_only: boolean;
    upload_date: string;
    ai_translated: boolean;
    nb_cd: number;
    slug: string;
    machine_translated: boolean;
    release: string;
    comments: string;
    legacy_subtitle_id: number;
    legacy_uploader_id: number;
    uploader: {
      uploader_id: number;
      name: string;
      rank: string;
    };
    feature_details: {
      feature_id: number;
      feature_type: string;
      year: number;
      title: string;
      movie_name: string;
      imdb_id: number;
      tmdb_id: number;
    };
    url: string;
    related_links: Array<{
      label: string;
      url: string;
      img_url: string;
    }>;
    files: Array<{
      file_id: number;
      cd_number: number;
      file_name: string;
    }>;
  };
}

interface OpenSubtitlesLoginResponse {
  user: {
    allowed_downloads: number;
    level: string;
    user_id: number;
    ext_installed: boolean;
    vip: boolean;
  };
  base_url: string;
  token: string;
  status: number;
}

interface OpenSubtitlesDownloadResponse {
  link: string;
  file_name: string;
  requests: number;
  remaining: number;
  message: string;
  reset_time: string;
  reset_time_utc: string;
}

export class OpenSubtitlesProvider implements SubtitleProvider {
  readonly name = "opensubtitles";
  readonly priority = 1; // Highest priority

  private config: OpenSubtitlesConfig;
  private authToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor() {
    this.config = {
      apiKey: process.env.OPENSUBTITLES_API_KEY || "",
      username: process.env.OPENSUBTITLES_USERNAME,
      password: process.env.OPENSUBTITLES_PASSWORD,
      userAgent: "OneDub v0.1",
      baseUrl: "https://api.opensubtitles.com/api/v1",
    };
  }

  async isAvailable(): Promise<boolean> {
    if (!this.config.apiKey) {
      return false;
    }

    try {
      // Try a simple search to check availability
      const testUrl = `${this.config.baseUrl}/subtitles?query=test&languages=en`;
      const response = await fetch(testUrl, {
        headers: {
          "Api-Key": this.config.apiKey,
          "User-Agent": this.config.userAgent,
          Accept: "application/json",
        },
      });
      if (!response.ok) {
        console.error(
          `OpenSubtitles isAvailable check failed: ${response.status} ${response.statusText}`
        );
      }
      return response.ok;
    } catch (error) {
      console.error("OpenSubtitles isAvailable check caught an error:", error);
      return false;
    }
  }

  async searchSubtitles(
    options: SubtitleFetchOptions
  ): Promise<SubtitleSearchResult> {
    try {
      if (!this.config.apiKey) {
        throw new AppError(
          AppErrorCode.INVALID_INPUT,
          "OpenSubtitles API key not configured"
        );
      }

      const strategy = getLanguageSearchStrategy(options.targetLanguage);

      // Step 1: Try target language only
      let response = await this.queryOpenSubtitles(options, strategy.primary);

      if (response.data.length > 0) {
        return this.formatSearchResult(response);
      }

      // Step 2: Try common languages (good for translation)
      response = await this.queryOpenSubtitles(options, strategy.fallback);

      if (response.data.length > 0) {
        return this.formatSearchResult(response);
      }

      // Step 3: Last resort - try all languages
      response = await this.queryOpenSubtitles(options, strategy.lastResort);

      return this.formatSearchResult(response);
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

  private async queryOpenSubtitles(
    options: SubtitleFetchOptions,
    languages: string
  ): Promise<OpenSubtitlesSearchResponse> {
    const searchUrls = this.buildSearchUrls(options, languages);
    let lastResult: OpenSubtitlesSearchResponse | null = null;

    for (const searchUrl of searchUrls) {
      const response = await fetch(searchUrl, {
        headers: {
          "Api-Key": this.config.apiKey,
          "User-Agent": this.config.userAgent,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new AppError(
          AppErrorCode.SERVICE_ERROR,
          `OpenSubtitles API request failed: ${response.status} ${response.statusText}`
        );
      }

      const result = await response.json();
      lastResult = result;

      if (result.data.length > 0) {
        return result;
      }
    }

    return (
      lastResult || {
        total_pages: 0,
        total_count: 0,
        per_page: 0,
        page: 1,
        data: [],
      }
    );
  }

  private formatSearchResult(
    data: OpenSubtitlesSearchResponse
  ): SubtitleSearchResult {
    const subtitles: SubtitleResult[] = data.data.map((subtitle) => ({
      url: subtitle.attributes.url,
      language: subtitle.attributes.language,
      fileId: subtitle.attributes.files[0]?.file_id,
      fileName:
        subtitle.attributes.files[0]?.file_name || subtitle.attributes.slug,
      downloadCount: subtitle.attributes.download_count,
      rating: subtitle.attributes.ratings,
      trusted: subtitle.attributes.from_trusted,
      hearingImpaired: subtitle.attributes.hearing_impaired,
      hd: subtitle.attributes.hd,
      aiTranslated: subtitle.attributes.ai_translated,
      machineTranslated: subtitle.attributes.machine_translated,
      foreignPartsOnly: subtitle.attributes.foreign_parts_only,
      release: subtitle.attributes.release,
      source: this.name,
    }));

    return {
      status: true,
      subtitles,
      provider: this.name,
    };
  }

  async downloadSubtitle(options: SubtitleDownloadOptions): Promise<string> {
    try {
      if (!options.fileId) {
        throw new AppError(
          AppErrorCode.INVALID_INPUT,
          "File ID is required for OpenSubtitles download"
        );
      }

      await this.ensureAuthenticated();

      // Request download link
      const downloadResponse = await fetch(`${this.config.baseUrl}/download`, {
        method: "POST",
        headers: {
          "Api-Key": this.config.apiKey,
          "User-Agent": this.config.userAgent,
          Authorization: `Bearer ${this.authToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          file_id: Number(options.fileId),
        }),
      });

      if (!downloadResponse.ok) {
        throw new AppError(
          AppErrorCode.SERVICE_ERROR,
          `Failed to get download link: ${downloadResponse.status} ${downloadResponse.statusText}`
        );
      }

      const downloadData: OpenSubtitlesDownloadResponse =
        await downloadResponse.json();

      if (!downloadData.link) {
        throw new AppError(
          AppErrorCode.SERVICE_ERROR,
          "No download link provided by OpenSubtitles"
        );
      }

      // Download the actual subtitle file
      const subtitleResponse = await fetch(downloadData.link, {
        headers: {
          "User-Agent": this.config.userAgent,
          Accept: "text/plain, */*",
        },
      });

      if (!subtitleResponse.ok) {
        throw new AppError(
          AppErrorCode.SERVICE_ERROR,
          `Failed to download subtitle file: ${subtitleResponse.status} ${subtitleResponse.statusText}`
        );
      }

      const content = await subtitleResponse.text();
      return content;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        AppErrorCode.SERVICE_ERROR,
        `Failed to download subtitle: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async ensureAuthenticated(): Promise<void> {
    // Check if we have a valid token
    if (this.authToken && Date.now() < this.tokenExpiresAt) {
      return;
    }

    // Only authenticate if we have username and password
    if (!this.config.username || !this.config.password) {
      return;
    }

    try {
      const loginResponse = await fetch(`${this.config.baseUrl}/login`, {
        method: "POST",
        headers: {
          "Api-Key": this.config.apiKey,
          "User-Agent": this.config.userAgent,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          username: this.config.username,
          password: this.config.password,
        }),
      });

      if (!loginResponse.ok) {
        throw new AppError(
          AppErrorCode.SERVICE_ERROR,
          `Authentication failed: ${loginResponse.status} ${loginResponse.statusText}`
        );
      }

      const loginData: OpenSubtitlesLoginResponse = await loginResponse.json();

      if (!loginData.token) {
        throw new AppError(
          AppErrorCode.SERVICE_ERROR,
          "No token received from OpenSubtitles"
        );
      }

      this.authToken = loginData.token;
      // Set token expiration to 23 hours from now (tokens typically expire in 24h)
      this.tokenExpiresAt = Date.now() + 23 * 60 * 60 * 1000;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        AppErrorCode.SERVICE_ERROR,
        `Authentication failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private buildSearchUrls(
    options: SubtitleFetchOptions,
    languages: string
  ): string[] {
    const urls: string[] = [];

    const buildParams = (seed: Record<string, string>) => {
      const params = new URLSearchParams(seed);

      params.set("languages", languages);

      if (options.seasonNumber && options.episodeNumber) {
        params.set("season_number", options.seasonNumber.toString());
        params.set("episode_number", options.episodeNumber.toString());
      }

      params.set("order_by", "download_count");
      params.set("order_direction", "desc");

      return `${this.config.baseUrl}/subtitles?${params.toString()}`;
    };

    if (options.imdbID) {
      urls.push(buildParams({ imdb_id: options.imdbID.replace(/^tt/, "") }));
    }

    if (options.title) {
      const titleParams: Record<string, string> = { query: options.title };
      if (options.year) {
        titleParams.year = options.year.toString();
      }
      urls.push(buildParams(titleParams));
    }

    return [...new Set(urls)];
  }
}
