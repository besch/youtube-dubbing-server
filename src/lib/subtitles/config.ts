import { SubtitleApiConfig } from "@/types/subtitles";

// Note: The subdl npm package doesn't require API configuration
// This function is kept for backward compatibility but may not be needed
export function getSubdlConfig(): SubtitleApiConfig {
  return {
    apiKey: "", // Not needed for npm subdl package
    baseUrl: "", // Not needed for npm subdl package
    downloadBaseUrl: "", // Not needed for npm subdl package
  };
}

export const SUBTITLE_CONFIG = {
  maxRetries: 3,
  downloadTimeout: 30000,
  supportedFormats: [".srt", ".vtt"],
  defaultEncoding: "utf-8",
} as const;

export const EPISODE_PATTERNS = [
  // S01E01 format
  (season: number, episode: number) =>
    new RegExp(
      `S${String(season).padStart(2, "0")}E${String(episode).padStart(
        2,
        "0"
      )}.*\\.srt$`,
      "i"
    ),
  // 1x01 format
  (season: number, episode: number) =>
    new RegExp(`${season}x${String(episode).padStart(2, "0")}.*\\.srt$`, "i"),
  // Episode number at start with dash
  (season: number, episode: number) =>
    new RegExp(`^${String(episode).padStart(2, "0")}\\s*-.*\\.srt$`, "i"),
  // Season and episode with dash prefix
  (season: number, episode: number) =>
    new RegExp(
      `-\\s*S${String(season).padStart(2, "0")}E${String(episode).padStart(
        2,
        "0"
      )}.*\\.srt$`,
      "i"
    ),
];
