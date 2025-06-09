// Main service
export { subtitleService, SubtitleService } from "./service";

// API client
export { SubdlApiClient } from "./api-client";

// Quality validator
export {
  subtitleQualityValidator,
  SubtitleQualityValidator,
} from "./quality-validator";
export type {
  SubtitleQualityResult,
  SubtitleValidationOptions,
} from "./quality-validator";

// Utilities
export {
  buildLanguageQueryString,
  buildFallbackLanguageQueryString,
  buildAllLanguagesQueryString,
  getLanguageSearchStrategy,
  insertNewLineIfWrongFormattedSRT,
  isTargetLanguage,
  logSubtitleOperation,
  logSubtitleError,
} from "./utils";

// Downloader
export {
  downloadAndExtractSubtitle,
  downloadSubtitleArchive,
  extractSubtitleFromArchive,
} from "./downloader";

// Configuration
export { getSubdlConfig, SUBTITLE_CONFIG, EPISODE_PATTERNS } from "./config";

// Re-export types
export type {
  SubdlSubtitle,
  SubdlApiResponse,
  SubtitleDownloadResult,
  SubtitleFetchOptions,
  SubtitleApiConfig,
  SupportedLanguage,
  SubtitleProcessingError,
} from "../../types/subtitles";

export { SUPPORTED_LANGUAGES } from "../../types/subtitles";
