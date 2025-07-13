// Primary export - the new provider system
export { subtitleProviderManager } from "./providers";
export * from "./providers/base";

// Keep essential services
export { subtitleService } from "./service";

// Keep essential utilities that might be used externally
export {
  insertNewLineIfWrongFormattedSRT,
  isTargetLanguage,
  logSubtitleOperation,
  logSubtitleError,
} from "./utils";

// Keep essential types
export type {
  SubtitleDownloadResult,
  SubtitleFetchOptions,
  SupportedLanguage,
  SubtitleProcessingError,
} from "@/types/subtitles";

export { SUPPORTED_LANGUAGES } from "@/types/subtitles";

// Translation service (still needed externally)
export { translateSubtitles } from "./translate";
