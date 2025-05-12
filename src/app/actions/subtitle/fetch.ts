"use server";

import { z } from "zod";
import fetch from "node-fetch"; // Keep for subdl calls
import unzipper from "unzipper";
import iconv from "iconv-lite";
import detectEncoding from "detect-file-encoding-and-language";

import { publicAction } from "../safe-action";
import { ActionResponse, AppError, AppErrorCode } from "../actions";
import { translateSubtitles } from "@/lib/subtitles"; // Assuming this path is correct

// Define the schema for input validation using Zod
const fetchSubtitlesSchema = z.object({
  imdbID: z.string().min(1, { message: "IMDb ID cannot be empty" }),
  languageCode: z
    .string()
    .length(2, { message: "Language code must be 2 characters" }),
  seasonNumber: z.number().int().min(1).optional(),
  episodeNumber: z.number().int().min(1).optional(),
});

export interface FetchSubtitlesOutput {
  srtContent: string;
  generated: boolean;
}

async function getOrGenerateSubtitles(
  imdbID: string,
  targetLanguage: string,
  seasonNumber?: number,
  episodeNumber?: number
): Promise<{ srtContent: string; generated: boolean }> {
  const result = await getBestSubtitle(
    imdbID,
    targetLanguage,
    seasonNumber,
    episodeNumber
  );

  if (!result) {
    throw new AppError(
      AppErrorCode.RECORD_NOT_FOUND,
      "No subtitles found for the given content after checking Subdl and attempting generation."
    );
  }

  return {
    srtContent: result.content,
    generated: result.generated,
  };
}

async function getBestSubtitle(
  imdbID: string,
  targetLanguage: string,
  seasonNumber?: number,
  episodeNumber?: number
): Promise<{ content: string; generated: boolean } | null> {
  const languages = ["en", "es", "fr", "ru", "de", "it", "pt", "ja", "zh"]; // Prioritized languages
  const languageString = `${targetLanguage},${languages
    .filter((lang) => lang !== targetLanguage)
    .join(",")}`;

  const subdlApiKey = process.env.SUBDL_API_KEY;
  if (!subdlApiKey) {
    throw new AppError(
      AppErrorCode.CONFIGURATION_ERROR,
      "Subdl API key is not configured."
    );
  }

  let url = `https://api.subdl.com/api/v1/subtitles?api_key=${subdlApiKey}&imdb_id=${imdbID}&languages=${languageString}`;

  if (seasonNumber !== undefined && episodeNumber !== undefined) {
    url += `&season_number=${seasonNumber}&episode_number=${episodeNumber}`;
  }

  console.log(`Querying Subdl: ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`Subdl API error! Status: ${response.status}`);
    throw new AppError(
      AppErrorCode.SERVICE_ERROR,
      `Subdl API request failed with status ${response.status}`
    );
  }

  const data = await response.json();

  if (
    data.success === false ||
    !data.subtitles ||
    data.subtitles.length === 0
  ) {
    console.warn(
      `Subdl: No subtitles found for primary query (target: ${targetLanguage}). Data: ${JSON.stringify(
        data
      )}`
    );
    // Attempt fallback to any language if the primary query (which included fallbacks) failed broadly
    const fallbackLanguageString = languages.join(",");
    const fallbackUrl = `https://api.subdl.com/api/v1/subtitles?api_key=${subdlApiKey}&imdb_id=${imdbID}&languages=${fallbackLanguageString}`;
    if (seasonNumber !== undefined && episodeNumber !== undefined) {
      url += `&season_number=${seasonNumber}&episode_number=${episodeNumber}`;
    }

    console.log(`Querying Subdl (fallback to any language): ${fallbackUrl}`);
    const fallbackResponse = await fetch(fallbackUrl);
    if (!fallbackResponse.ok) {
      console.error(
        `Subdl fallback API error! Status: ${fallbackResponse.status}`
      );
      // If even broad fallback fails, it's likely no subs exist or Subdl issue
      return null;
    }

    const fallbackData = await fallbackResponse.json();
    if (
      fallbackData.success === false ||
      !fallbackData.subtitles ||
      fallbackData.subtitles.length === 0
    ) {
      console.warn(
        `Subdl: No subtitles found even with broad fallback. Fallback Data: ${JSON.stringify(
          fallbackData
        )}`
      );
      return null; // No subtitles found even with broad fallback
    }

    // If fallback found something, use the first one and translate
    const bestFallbackSubtitle = fallbackData.subtitles[0];
    console.log(
      `Subdl: Found fallback subtitle in '${bestFallbackSubtitle.language}'. Will translate to '${targetLanguage}'.`
    );
    let subtitleContent = await downloadAndExtractSubtitle(
      bestFallbackSubtitle.url,
      seasonNumber,
      episodeNumber
    );
    subtitleContent = insertNewLineIfWrongFormattedSRT(subtitleContent);

    if (
      bestFallbackSubtitle.language.toLowerCase() ===
      targetLanguage.toLowerCase()
    ) {
      return { content: subtitleContent, generated: false }; // Already in target lang somehow
    }

    const translatedContent = await translateSubtitles(
      subtitleContent,
      bestFallbackSubtitle.language, // Source is from this subtitle
      targetLanguage
    );
    return { content: translatedContent, generated: true };
  }

  // Process successful primary query data
  const targetLangSubtitles = data.subtitles.filter(
    (sub: any) => sub.language.toLowerCase() === targetLanguage.toLowerCase()
  );

  if (targetLangSubtitles.length > 0) {
    console.log(
      `Subdl: Found ${targetLangSubtitles.length} subtitles in target language '${targetLanguage}'.`
    );
    for (const subtitle of targetLangSubtitles) {
      try {
        let subtitleContent = await downloadAndExtractSubtitle(
          subtitle.url,
          seasonNumber,
          episodeNumber
        );
        subtitleContent = insertNewLineIfWrongFormattedSRT(subtitleContent);
        return { content: subtitleContent, generated: false };
      } catch (error) {
        console.warn(
          `Failed to download/extract subtitle from Subdl: ${subtitle.url}`,
          error
        );
        // Continue to next subtitle in target language
      }
    }
    // If all target language subtitles failed to download, fall through to translate best available
    console.warn(
      `Subdl: All ${targetLangSubtitles.length} target language subtitles failed to download. Will attempt translation from best available.`
    );
  }

  // If no target language subtitles found, or all failed, use the first available from primary query and translate
  const bestOverallSubtitle = data.subtitles[0]; // Subdl usually sorts by quality
  console.log(
    `Subdl: No direct subtitle for '${targetLanguage}' found or downloadable. Using best available ('${bestOverallSubtitle.language}') and translating.`
  );
  let subtitleContent = await downloadAndExtractSubtitle(
    bestOverallSubtitle.url,
    seasonNumber,
    episodeNumber
  );
  subtitleContent = insertNewLineIfWrongFormattedSRT(subtitleContent);

  if (
    bestOverallSubtitle.language.toLowerCase() === targetLanguage.toLowerCase()
  ) {
    return { content: subtitleContent, generated: false }; // Should have been caught above, but safeguard
  }

  const translatedContent = await translateSubtitles(
    subtitleContent,
    bestOverallSubtitle.language,
    targetLanguage
  );
  return { content: translatedContent, generated: true };
}

function insertNewLineIfWrongFormattedSRT(input: string): string {
  // Adjusted to handle cases where there might be no newline after the number
  // and to ensure it's at the start of a line.
  return input
    .replace(/^(\d+)(?!\r?\n)/gm, "\n$1\r\n")
    .replace(/^(\d+)(\r?\n)(?=\d)/gm, "\n$1$2");
}

async function downloadAndExtractSubtitle(
  subdlPath: string, // Changed from 'url' to 'subdlPath' for clarity
  seasonNumber?: number,
  episodeNumber?: number
): Promise<string> {
  const downloadUrl = `https://dl.subdl.com${subdlPath}`;
  console.log(`Downloading subtitle from: ${downloadUrl}`);
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    console.error(
      `Failed to download subtitle ZIP from ${downloadUrl}. Status: ${response.status}`
    );
    throw new Error(
      `HTTP error downloading subtitle ZIP! status: ${response.status}`
    );
  }

  const buffer = await response.buffer();
  const zip = await unzipper.Open.buffer(buffer);

  let subtitleBuffer: Buffer | null = null;

  // Attempt to find specific episode/season SRT first
  if (seasonNumber !== undefined && episodeNumber !== undefined) {
    const episodePatterns = [
      new RegExp(
        `S${String(seasonNumber).padStart(2, "0")}E${String(
          episodeNumber
        ).padStart(2, "0")}.*\\.srt$`, // Escaped backslash for regex literal
        "i"
      ),
      new RegExp(
        `${seasonNumber}x${String(episodeNumber).padStart(2, "0")}.*\\.srt$`, // Escaped backslash
        "i"
      ),
      new RegExp(
        `^${String(episodeNumber).padStart(2, "0")}\\s*-.*\\.srt$`, // Escaped backslash and whitespace char
        "i"
      ),
      new RegExp(
        `-\\s*S${String(seasonNumber).padStart(2, "0")}E${String(
          episodeNumber
        ).padStart(2, "0")}.*\\.srt$`, // Escaped backslash and whitespace char
        "i"
      ),
    ];

    const matchingEntry = zip.files.find((entry) =>
      episodePatterns.some((pattern) => pattern.test(entry.path))
    );

    if (matchingEntry) {
      console.log(`Found matching series subtitle: ${matchingEntry.path}`);
      subtitleBuffer = await matchingEntry.buffer();
    }
  }

  // If no specific series match or it's a movie, find the first .srt file
  if (!subtitleBuffer) {
    const srtEntry = zip.files.find((entry) =>
      entry.path.toLowerCase().endsWith(".srt")
    );
    if (srtEntry) {
      console.log(`Found generic SRT file: ${srtEntry.path}`);
      subtitleBuffer = await srtEntry.buffer();
    } else {
      console.error("No .srt file found in the downloaded zip from Subdl.");
      throw new Error("No .srt file found in the downloaded zip from Subdl");
    }
  }

  const encodingInfo = await detectEncoding(subtitleBuffer);
  const encoding = encodingInfo?.encoding || "utf-8";
  console.log(`Detected subtitle encoding: ${encoding}`);

  const subtitleContent = iconv.decode(subtitleBuffer, encoding);
  return subtitleContent;
}

// Create the safe action
export const fetchSubtitles = publicAction
  .schema(fetchSubtitlesSchema)
  .action(
    async ({ parsedInput }): Promise<ActionResponse<FetchSubtitlesOutput>> => {
      const { imdbID, languageCode, seasonNumber, episodeNumber } = parsedInput;

      console.log(
        `Fetching subtitles for IMDb: ${imdbID}, Lang: ${languageCode}, S: ${seasonNumber}, E: ${episodeNumber}`
      );

      try {
        const { srtContent, generated } = await getOrGenerateSubtitles(
          imdbID,
          languageCode,
          seasonNumber,
          episodeNumber
        );

        console.log(
          `Successfully fetched/generated subtitles for ${imdbID}. Generated: ${generated}`
        );
        return { success: true, data: { srtContent, generated } };
      } catch (error: unknown) {
        console.error("Error in fetchSubtitles action:", error);
        if (error instanceof AppError) {
          return { success: false, error };
        }
        return {
          success: false,
          error: new AppError(
            AppErrorCode.UNEXPECTED_ERROR,
            error instanceof Error ? error.message : "Failed to fetch subtitles"
          ),
        };
      }
    }
  );
