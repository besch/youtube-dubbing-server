import fetch from "node-fetch";
import unzipper from "unzipper";
import iconv from "iconv-lite";
import detectEncoding from "detect-file-encoding-and-language";

import { AppError, AppErrorCode } from "@/app/actions/actions";
import { EPISODE_PATTERNS, SUBTITLE_CONFIG } from "./config";
import { logSubtitleOperation, logSubtitleError } from "./utils";

export async function downloadSubtitleArchive(
  downloadUrl: string
): Promise<Buffer> {
  logSubtitleOperation("Download", { url: downloadUrl });

  try {
    const response = await fetch(downloadUrl, {
      timeout: SUBTITLE_CONFIG.downloadTimeout,
    });

    if (!response.ok) {
      throw new AppError(
        AppErrorCode.SERVICE_ERROR,
        `Failed to download subtitle archive: HTTP ${response.status} ${response.statusText}`
      );
    }

    return await response.buffer();
  } catch (error) {
    logSubtitleError("Download", error, { url: downloadUrl });

    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      AppErrorCode.SERVICE_ERROR,
      `Network error downloading subtitle archive: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

export async function extractSubtitleFromArchive(
  buffer: Buffer,
  seasonNumber?: number,
  episodeNumber?: number
): Promise<string> {
  logSubtitleOperation("Extract", {
    hasSeasonEpisode: seasonNumber !== undefined && episodeNumber !== undefined,
    bufferSize: buffer.length,
  });

  try {
    const zip = await unzipper.Open.buffer(buffer);
    let subtitleBuffer: Buffer | null = null;

    // Try to find episode-specific subtitle if season/episode provided
    if (seasonNumber !== undefined && episodeNumber !== undefined) {
      subtitleBuffer = await findEpisodeSubtitle(
        zip,
        seasonNumber,
        episodeNumber
      );
    }

    // Fall back to first SRT file if no episode-specific file found
    if (!subtitleBuffer) {
      subtitleBuffer = await findFirstSrtFile(zip);
    }

    if (!subtitleBuffer) {
      throw new AppError(
        AppErrorCode.RECORD_NOT_FOUND,
        "No .srt file found in the downloaded archive"
      );
    }

    return await decodeSubtitleContent(subtitleBuffer);
  } catch (error) {
    logSubtitleError("Extract", error);

    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      AppErrorCode.SERVICE_ERROR,
      `Failed to extract subtitle from archive: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

async function findEpisodeSubtitle(
  zip: unzipper.CentralDirectory,
  seasonNumber: number,
  episodeNumber: number
): Promise<Buffer | null> {
  for (const patternFn of EPISODE_PATTERNS) {
    const pattern = patternFn(seasonNumber, episodeNumber);
    const matchingEntry = zip.files.find((entry) => pattern.test(entry.path));

    if (matchingEntry) {
      logSubtitleOperation("EpisodeMatch", {
        pattern: pattern.source,
        fileName: matchingEntry.path,
      });
      return await matchingEntry.buffer();
    }
  }

  return null;
}

async function findFirstSrtFile(
  zip: unzipper.CentralDirectory
): Promise<Buffer | null> {
  const srtEntry = zip.files.find((entry) =>
    entry.path.toLowerCase().endsWith(".srt")
  );

  if (srtEntry) {
    logSubtitleOperation("FirstSrtMatch", { fileName: srtEntry.path });
    return await srtEntry.buffer();
  }

  return null;
}

async function decodeSubtitleContent(buffer: Buffer): Promise<string> {
  try {
    const encodingInfo = await detectEncoding(buffer);
    let encoding = encodingInfo?.encoding || SUBTITLE_CONFIG.defaultEncoding;

    // A common issue is Cyrillic (Windows-1251) being misidentified as Latin-1.
    // Only override when the decoded text strongly looks Cyrillic; otherwise
    // keep Latin-1 so Western European subtitles are not corrupted.
    if (encoding === "ISO-8859-1") {
      const cp1251Text = iconv.decode(buffer, "CP1251");
      const cyrillicMatches = cp1251Text.match(/[\u0400-\u04FF]/g)?.length ?? 0;
      if (cyrillicMatches > 20) {
        encoding = "CP1251";
        logSubtitleOperation("Decode_EncodingOverride", {
          detected: "ISO-8859-1",
          overriddenTo: "CP1251",
          cyrillicMatches,
        });
      }
    }

    logSubtitleOperation("Decode", {
      detectedEncoding: encodingInfo?.encoding,
      usedEncoding: encoding,
      bufferSize: buffer.length,
    });

    return iconv.decode(buffer, encoding);
  } catch (error) {
    logSubtitleError("Decode", error);

    // Fall back to UTF-8 if encoding detection fails
    return iconv.decode(buffer, SUBTITLE_CONFIG.defaultEncoding);
  }
}

export async function downloadAndExtractSubtitle(
  subdlPath: string,
  seasonNumber?: number,
  episodeNumber?: number
): Promise<string> {
  const downloadUrl = `https://dl.subdl.com${subdlPath}`;

  const buffer = await downloadSubtitleArchive(downloadUrl);
  const content = await extractSubtitleFromArchive(
    buffer,
    seasonNumber,
    episodeNumber
  );

  return content;
}
