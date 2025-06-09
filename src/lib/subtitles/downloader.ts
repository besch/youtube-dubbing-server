import { AppError, AppErrorCode } from "@/app/actions/actions";
import { EPISODE_PATTERNS, SUBTITLE_CONFIG } from "./config";
import { logSubtitleOperation, logSubtitleError } from "./utils";

export async function downloadSubtitleArchive(
  downloadUrl: string
): Promise<Buffer> {
  logSubtitleOperation("Download", { url: downloadUrl });

  try {
    // Handle data URLs from subdl package
    if (downloadUrl.startsWith("data:text/srt;base64,")) {
      const base64Data = downloadUrl.replace("data:text/srt;base64,", "");
      return Buffer.from(base64Data, "base64");
    }

    // Fallback for regular URLs (if any legacy URLs exist)
    const fetch = (await import("node-fetch")).default;
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
    // Since subdl package returns direct SRT content, we can decode it directly
    const content = buffer.toString("utf-8");

    // If this looks like SRT content, return it directly
    if (content.includes("-->") && /^\d+$/m.test(content)) {
      logSubtitleOperation("DirectSrtContent", {
        contentLength: content.length,
      });
      return content;
    }

    // Otherwise, try to extract from ZIP (fallback for legacy URLs)
    const unzipper = (await import("unzipper")).default;
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
  zip: any,
  seasonNumber: number,
  episodeNumber: number
): Promise<Buffer | null> {
  for (const patternFn of EPISODE_PATTERNS) {
    const pattern = patternFn(seasonNumber, episodeNumber);
    const matchingEntry = zip.files.find((entry: any) =>
      pattern.test(entry.path)
    );

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

async function findFirstSrtFile(zip: any): Promise<Buffer | null> {
  const srtEntry = zip.files.find((entry: any) =>
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
    const detectEncoding = (await import("detect-file-encoding-and-language"))
      .default;
    const iconv = (await import("iconv-lite")).default;

    const encodingInfo = await detectEncoding(buffer);
    const encoding = encodingInfo?.encoding || SUBTITLE_CONFIG.defaultEncoding;

    logSubtitleOperation("Decode", {
      detectedEncoding: encodingInfo?.encoding,
      usedEncoding: encoding,
      bufferSize: buffer.length,
    });

    return iconv.decode(buffer, encoding);
  } catch (error) {
    logSubtitleError("Decode", error);

    // Fall back to UTF-8 if encoding detection fails
    return buffer.toString("utf-8");
  }
}

export async function downloadAndExtractSubtitle(
  subdlPath: string,
  seasonNumber?: number,
  episodeNumber?: number
): Promise<string> {
  // For data URLs, subdlPath is the full data URL
  const buffer = await downloadSubtitleArchive(subdlPath);
  const content = await extractSubtitleFromArchive(
    buffer,
    seasonNumber,
    episodeNumber
  );

  return content;
}
