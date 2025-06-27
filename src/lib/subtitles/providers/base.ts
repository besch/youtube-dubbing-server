export interface SubtitleResult {
  url: string;
  language: string;
  fileId?: string | number;
  fileName?: string;
  downloadCount?: number;
  rating?: number;
  source: string;
}

export interface SubtitleSearchResult {
  status: boolean;
  subtitles: SubtitleResult[];
  error?: string;
  message?: string;
  provider: string;
}

export interface SubtitleFetchOptions {
  imdbID: string;
  targetLanguage: string;
  seasonNumber?: number;
  episodeNumber?: number;
  year?: number;
  title?: string;
}

export interface SubtitleDownloadOptions {
  fileId?: string | number;
  url?: string;
}

export interface SubtitleProvider {
  readonly name: string;
  readonly priority: number; // Lower number = higher priority

  /**
   * Search for subtitles using the provider
   */
  searchSubtitles(options: SubtitleFetchOptions): Promise<SubtitleSearchResult>;

  /**
   * Download subtitle content from the provider
   */
  downloadSubtitle(options: SubtitleDownloadOptions): Promise<string>;

  /**
   * Check if the provider is available/healthy
   */
  isAvailable(): Promise<boolean>;
}
