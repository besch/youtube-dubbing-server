"use server";

import { z } from "zod";
import fetch from "node-fetch"; // Keep for subdl calls
import unzipper from "unzipper";
import iconv from "iconv-lite";
import detectEncoding from "detect-file-encoding-and-language";
import { createSafeActionClient } from "next-safe-action";

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

type FetchSubtitlesInput = z.infer<typeof fetchSubtitlesSchema>;

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
  const languages = ["en", "es", "fr", "ru", "de", "it", "pt", "ja", "zh"];

  let languageStringForApiCall: string;
  if (targetLanguage.toLowerCase() === "en") {
    languageStringForApiCall = "en";
  } else {
    languageStringForApiCall = `${targetLanguage},${languages
      .filter((lang) => lang !== targetLanguage && lang !== "en")
      .join(",")}`;
    if (
      targetLanguage.toLowerCase() !== "en" &&
      !languageStringForApiCall.includes("en")
    ) {
      languageStringForApiCall += ",en";
    }
  }

  const subdlApiKey = process.env.SUBDL_API_KEY;
  if (!subdlApiKey) {
    throw new AppError(
      AppErrorCode.CONFIGURATION_ERROR,
      "Subdl API key is not configured."
    );
  }

  let url = `https://api.subdl.com/api/v1/subtitles?api_key=${subdlApiKey}&imdb_id=${imdbID}&languages=${languageStringForApiCall}`;

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
      `Subdl: No subtitles found for primary query (target: ${targetLanguage}, API lang param: ${languageStringForApiCall}). Attempting broad fallback.`
    );
    const fallbackLanguageString = languages.join(",");
    let finalFallbackUrl = `https://api.subdl.com/api/v1/subtitles?api_key=${subdlApiKey}&imdb_id=${imdbID}&languages=${fallbackLanguageString}`;
    if (seasonNumber !== undefined && episodeNumber !== undefined) {
      finalFallbackUrl += `&season_number=${seasonNumber}&episode_number=${episodeNumber}`;
    }
    console.log(
      `Querying Subdl (broad fallback to any language): ${finalFallbackUrl}`
    );
    const fallbackResponse = await fetch(finalFallbackUrl);
    if (!fallbackResponse.ok) {
      console.error(
        `Subdl fallback API error! Status: ${fallbackResponse.status}`
      );
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
      return null;
    }
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
      return { content: subtitleContent, generated: false };
    }
    const translatedContent = await translateSubtitles(
      subtitleContent,
      bestFallbackSubtitle.language,
      targetLanguage
    );
    return { content: translatedContent, generated: true };
  }

  const targetLangSubtitles = data.subtitles.filter(
    (sub: any) => sub.language.toLowerCase() === targetLanguage.toLowerCase()
  );

  if (targetLangSubtitles.length > 0) {
    console.log(
      `Subdl: Found ${targetLangSubtitles.length} subtitles in target language '${targetLanguage}'. Attempting to download them directly.`
    );
    for (const subtitle of targetLangSubtitles) {
      try {
        let subtitleContent = await downloadAndExtractSubtitle(
          subtitle.url,
          seasonNumber,
          episodeNumber
        );
        subtitleContent = insertNewLineIfWrongFormattedSRT(subtitleContent);
        console.log(
          `Subdl: Successfully downloaded/extracted direct hit for ${targetLanguage}: ${subtitle.url}`
        );
        return { content: subtitleContent, generated: false };
      } catch (error) {
        console.warn(
          `Subdl: Failed to download/extract direct hit from ${subtitle.url} for ${targetLanguage}. Error:`,
          error
        );
      }
    }
    console.warn(
      `Subdl: All ${targetLangSubtitles.length} target language subtitles failed to download. Will attempt translation from best available.`
    );
  }

  const bestOverallSubtitle = data.subtitles[0];
  console.log(
    `Subdl: No direct subtitle for '${targetLanguage}' found or downloadable. Using best available ('${bestOverallSubtitle.language}', URL: ${bestOverallSubtitle.url}) and potentially translating.`
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
    return { content: subtitleContent, generated: false };
  }

  const translatedContent = await translateSubtitles(
    subtitleContent,
    bestOverallSubtitle.language,
    targetLanguage
  );
  return { content: translatedContent, generated: true };
}

function insertNewLineIfWrongFormattedSRT(input: string): string {
  return input.replace(/^(\d+)(\r?\n)/gm, "\n$1$2");
}

async function downloadAndExtractSubtitle(
  subdlPath: string,
  seasonNumber?: number,
  episodeNumber?: number
): Promise<string> {
  const downloadUrl = `https://dl.subdl.com${subdlPath}`;
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    console.error(
      `DownloadAndExtract: Failed to download subtitle ZIP from ${downloadUrl}. Status: ${response.status}, StatusText: ${response.statusText}`
    );
    throw new Error(
      `HTTP error downloading subtitle ZIP! status: ${response.status}`
    );
  }

  const buffer = await response.buffer();
  const zip = await unzipper.Open.buffer(buffer);

  let subtitleBuffer: Buffer | null = null;

  if (seasonNumber !== undefined && episodeNumber !== undefined) {
    const episodePatterns = [
      new RegExp(
        `S${String(seasonNumber).padStart(2, "0")}E${String(
          episodeNumber
        ).padStart(2, "0")}.*\\.srt$`,
        "i"
      ),
      new RegExp(
        `${seasonNumber}x${String(episodeNumber).padStart(2, "0")}.*\\.srt$`,
        "i"
      ),
      new RegExp(
        `^${String(episodeNumber).padStart(2, "0")}\\s*-.*\\.srt$`,
        "i"
      ),
      new RegExp(
        `-\\s*S${String(seasonNumber).padStart(2, "0")}E${String(
          episodeNumber
        ).padStart(2, "0")}.*\\.srt$`,
        "i"
      ),
    ];

    const matchingEntry = zip.files.find((entry) =>
      episodePatterns.some((pattern) => pattern.test(entry.path))
    );

    if (matchingEntry) {
      subtitleBuffer = await matchingEntry.buffer();
    }
  }

  if (!subtitleBuffer) {
    const srtEntry = zip.files.find((entry) =>
      entry.path.toLowerCase().endsWith(".srt")
    );
    if (srtEntry) {
      subtitleBuffer = await srtEntry.buffer();
    } else {
      console.error(
        "DownloadAndExtract: No .srt file found in the downloaded zip from Subdl using .srt extension strategy."
      );
      throw new Error("No .srt file found in the downloaded zip from Subdl");
    }
  }

  const encodingInfo = await detectEncoding(subtitleBuffer);
  const encoding = encodingInfo?.encoding || "utf-8";

  const subtitleContent = iconv.decode(subtitleBuffer, encoding);
  return subtitleContent;
}

// Create the safe action
export const fetchSubtitles = createSafeActionClient()(
  fetchSubtitlesSchema,
  async (
    input: FetchSubtitlesInput
  ): Promise<ActionResponse<FetchSubtitlesOutput>> => {
    const { imdbID, languageCode, seasonNumber, episodeNumber } = input;

    console.log(
      `Fetching subtitles for IMDb: ${imdbID}, Lang: ${languageCode}, S: ${seasonNumber}, E: ${episodeNumber}`
    );

    try {
      const subtitleResult = await getOrGenerateSubtitles(
        imdbID,
        languageCode,
        seasonNumber,
        episodeNumber
      );

      if (!subtitleResult || typeof subtitleResult.srtContent !== "string") {
        console.error(
          `FetchSubtitles: getOrGenerateSubtitles returned unexpected data for ${imdbID}. Result:`,
          subtitleResult
        );
        return {
          success: false,
          error: new AppError(
            AppErrorCode.UNEXPECTED_ERROR,
            "Subtitle generation process returned invalid data."
          ),
        };
      }

      const { srtContent, generated } = subtitleResult;

      console.log(
        `Successfully fetched/generated subtitles for ${imdbID}. Generated: ${generated}, SRT Length: ${srtContent.length}`
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
