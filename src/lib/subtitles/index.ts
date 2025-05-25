// Main service
export { subtitleService, SubtitleService } from "./service";

// API client
export { SubdlApiClient } from "./api-client";

// Utilities
export {
  buildLanguageQueryString,
  buildFallbackLanguageQueryString,
  buildAllLanguagesQueryString,
  getLanguageSearchStrategy,
  buildSubdlUrl,
  redactApiKey,
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
