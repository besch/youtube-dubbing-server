import { SubtitleApiConfig } from "@/types/subtitles";
import { AppError, AppErrorCode } from "@/app/actions/actions";

export function getSubdlConfig(): SubtitleApiConfig {
  const apiKey = process.env.SUBDL_API_KEY;

  if (!apiKey) {
    throw new AppError(
      AppErrorCode.CONFIGURATION_ERROR,
      "Subdl API key is not configured."
    );
  }

  return {
    apiKey,
    baseUrl: "https://api.subdl.com/api/v1",
    downloadBaseUrl: "https://dl.subdl.com",
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
  // S1E1 format
  (season: number, episode: number) =>
    new RegExp(`S0?${season}E0?${episode}.*\\.srt$`, "i"),
  // 1x01 format
  (season: number, episode: number) =>
    new RegExp(`${season}x0?${episode}.*\\.srt$`, "i"),
  // Season 1 Episode 1 / Season.1.Episode.1 format
  (season: number, episode: number) =>
    new RegExp(
      `season[\\s._-]*0?${season}.*episode[\\s._-]*0?${episode}.*\\.srt$`,
      "i"
    ),
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
