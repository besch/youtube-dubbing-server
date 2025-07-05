export interface SubdlSubtitle {
  url: string;
  language: string;
  file_name: string;
  author: string;
  comment: string;
  rating: number;
  download_count: number;
  release_name: string;
  fps: number;
  cd_count: number;
  hi: boolean;
}

export interface SubdlApiResponse {
  status: boolean;
  subtitles: SubdlSubtitle[];
  results?: SubdlSubtitle[];
  totalPages?: number;
  currentPage?: number;
  message?: string;
  error?: string;
}

export interface SubtitleDownloadResult {
  content: string;
  generated: boolean;
  sourceLanguage?: string;
}

export interface SubtitleFetchOptions {
  imdbID: string;
  targetLanguage: string;
  seasonNumber?: number;
  episodeNumber?: number;
  title?: string;
  year?: number;
}

export interface SubtitleApiConfig {
  apiKey: string;
  baseUrl: string;
  downloadBaseUrl: string;
}

export const SUPPORTED_LANGUAGES = [
  "en",
  "es",
  "fr",
  "ru",
  "de",
  "it",
  "pt",
  "ja",
  "zh",
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export interface SubtitleProcessingError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
