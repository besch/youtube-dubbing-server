"use server";

import { z } from "zod";
import { protectedAction } from "../safe-action";
import { supabaseServiceRoleClient } from "@/lib/supabase/serviceRoleClient";
import { ActionResponse, AppError, AppErrorCode, appErrors } from "../actions";
import { config } from "@/config";
import {
  formatTranscriptionForTranslation,
  parseTranslationResponse,
  translateText,
  translateSimpleText,
} from "@/lib/translate";
import type { ReplicateSegmentOutput } from "@/lib/replicate";

// --- New Action: Translate Segment Content ---
const translateSegmentContentSchema = z.object({
  segmentId: z.string().uuid(),
  targetLanguage: z.string().length(2), // ISO 639-1 code
});

export const translateSegmentContent = protectedAction
  .schema(translateSegmentContentSchema)
  .action(async ({ parsedInput, ctx }): Promise<ActionResponse<null>> => {
    const { segmentId, targetLanguage } = parsedInput;
    const supabase = supabaseServiceRoleClient;

    console.log(
      `Translating segment ${segmentId} to language: ${targetLanguage}`
    );

    try {
      // 1. Fetch the segment data
      const { data: segmentDataUntyped, error: fetchError } = await supabase
        .from("transcription_segments")
        .select("id, content, translations")
        .eq("id", segmentId)
        .single();

      if (fetchError)
        throw new AppError(
          AppErrorCode.DATABASE_ERROR,
          `DB error fetching segment ${segmentId}: ${fetchError.message}`
        );
      if (!segmentDataUntyped)
        throw new AppError(
          AppErrorCode.RECORD_NOT_FOUND,
          `Segment ${segmentId} not found.`
        );

      // Revert to using 'as any' due to persistent type issues
      const segmentData = segmentDataUntyped as any;
      const existingTranslations = (segmentData.translations ?? {}) as Record<
        string,
        ReplicateSegmentOutput
      >;

      if (existingTranslations[targetLanguage]) {
        console.log(
          `>>> translateSegmentContent: Translation for ${targetLanguage} already exists for segment ${segmentId}. Skipping API call and returning success.`
        );
        return { success: true, data: null };
      } else {
        console.log(
          `>>> translateSegmentContent: Translation for ${targetLanguage} not found for segment ${segmentId}. Proceeding with API call.`
        );

        let originalContent: ReplicateSegmentOutput | null = null;
        if (
          segmentData.content &&
          typeof segmentData.content === "object" &&
          !Array.isArray(segmentData.content) &&
          "segments" in segmentData.content &&
          Array.isArray(segmentData.content.segments)
        ) {
          originalContent = segmentData.content as ReplicateSegmentOutput;
        } else {
          throw new AppError(
            AppErrorCode.INVALID_INPUT,
            `Segment ${segmentId} has invalid 'content' structure for translation.`
          );
        }

        if (
          !originalContent?.segments ||
          originalContent.segments.length === 0
        ) {
          console.log(
            `Segment ${segmentId} content is empty, skipping translation.`
          );
          return { success: true, data: null };
        }

        const sourceLangCode = originalContent.detected_language || "en";
        const sourceLangName =
          config.languages.find((l) => l.code === sourceLangCode)?.name ||
          sourceLangCode;
        const targetLangName =
          config.languages.find((l) => l.code === targetLanguage)?.name ||
          targetLanguage;

        if (sourceLangCode === targetLanguage) {
          console.log(
            `Source and target language (${targetLanguage}) are the same for segment ${segmentId}. Skipping translation call.`
          );
          return { success: true, data: null };
        }

        const textToTranslate = formatTranscriptionForTranslation(
          originalContent.segments
        );
        if (!textToTranslate) {
          console.log(`No text found to translate in segment ${segmentId}.`);
          return { success: true, data: null };
        }

        console.log(
          `Calling Translation Service (Gemini) to translate segment ${segmentId} to ${targetLangName}`
        );

        const translatedText = await translateText(
          textToTranslate,
          targetLangName
        );

        if (!translatedText) {
          throw new AppError(
            AppErrorCode.SERVICE_ERROR,
            "Translation service returned empty response."
          );
        }

        const parsedSegments = parseTranslationResponse(
          translatedText,
          originalContent.segments
        );
        if (!parsedSegments) {
          throw new AppError(
            AppErrorCode.SERVICE_ERROR,
            `Failed to parse translation response for segment ${segmentId}. Raw: ${translatedText.substring(
              0,
              100
            )}`
          );
        }

        const translatedContent: ReplicateSegmentOutput = {
          segments: parsedSegments,
        };

        const updatedTranslations = {
          ...((segmentData.translations || {}) as object),
          [targetLanguage]: translatedContent,
        };

        console.log(
          `>>> translateSegmentContent: Attempting to update DB for segment ${segmentId} with translations for language ${targetLanguage}`
        );
        const { error: updateError } = await supabase
          .from("transcription_segments")
          .update({ translations: updatedTranslations } as any)
          .eq("id", segmentId);

        if (updateError) {
          console.error(
            `>>> translateSegmentContent: DB Update Error for segment ${segmentId}:`,
            updateError
          );
          throw new AppError(
            AppErrorCode.DATABASE_ERROR,
            `DB error updating translations for segment ${segmentId}: ${updateError.message}`
          );
        } else {
          console.log(
            `>>> translateSegmentContent: DB Update successful for segment ${segmentId}. Realtime event should trigger.`
          );
        }

        console.log(
          `Successfully translated and stored ${targetLanguage} for segment ${segmentId}.`
        );
        return { success: true, data: null };
      }
    } catch (error: unknown) {
      console.error(
        `Error translating segment ${segmentId} to ${targetLanguage}:`,
        error
      );
      const appErr =
        error instanceof AppError ? error : appErrors.UNEXPECTED_ERROR;
      return { success: false, error: appErr };
    }
  });

// --- Action: Translate Video Title ---
const translateVideoTitleSchema = z.object({
  videoId: z.string().uuid(),
  targetLanguage: z.string().length(2), // ISO 639-1 code
});

type TranslateVideoTitleOutput = {
  translatedTitle: string | null;
};

export const translateVideoTitle = protectedAction
  .schema(translateVideoTitleSchema)
  .action(
    async ({
      parsedInput,
      ctx,
    }): Promise<ActionResponse<TranslateVideoTitleOutput>> => {
      const { videoId, targetLanguage } = parsedInput;
      const supabase = supabaseServiceRoleClient;

      console.log(
        `Translating title for video ${videoId} to language: ${targetLanguage}`
      );

      try {
        const { data: videoData, error: fetchError } = await supabase
          .from("videos")
          .select("id, title, translated_titles")
          .eq("id", videoId)
          .single();

        if (fetchError) {
          console.error(`DB error fetching video ${videoId}:`, fetchError);
          throw new AppError(
            AppErrorCode.DATABASE_ERROR,
            `DB error fetching video ${videoId}: ${fetchError.message}`
          );
        }

        if (!videoData) {
          throw new AppError(
            AppErrorCode.RECORD_NOT_FOUND,
            `Video ${videoId} not found.`
          );
        }

        const typedVideoData = videoData as any;
        const originalTitle = typedVideoData.title;
        const existingTranslations = (typedVideoData.translated_titles ??
          {}) as Record<string, string>;

        if (
          !originalTitle ||
          originalTitle.trim() === "" ||
          targetLanguage === "en"
        ) {
          console.log(
            `Skipping title translation for video ${videoId}: Original title empty, invalid, or target is English.`
          );
          return {
            success: true,
            data: {
              translatedTitle: targetLanguage === "en" ? originalTitle : null,
            },
          };
        }

        if (existingTranslations[targetLanguage]) {
          console.log(
            `Title translation for ${targetLanguage} already exists for video ${videoId}.`
          );
          return {
            success: true,
            data: {
              translatedTitle: existingTranslations[targetLanguage],
            },
          };
        }

        const sourceLangCode = "en";
        const sourceLangName =
          config.languages.find((l) => l.code === sourceLangCode)?.name ||
          sourceLangCode;
        const targetLangName =
          config.languages.find((l) => l.code === targetLanguage)?.name ||
          targetLanguage;

        console.log(
          `Calling Translation Service (Gemini) to translate title "${originalTitle}" from ${sourceLangName} to ${targetLangName} for video ${videoId}`
        );

        const translatedTitleText = await translateSimpleText(
          originalTitle,
          targetLangName
        );

        if (!translatedTitleText || translatedTitleText.trim() === "") {
          console.warn(
            `Translation service returned empty title for video ${videoId}`
          );
          return {
            success: true,
            data: { translatedTitle: null },
          };
        }

        const updatedTranslations = {
          ...existingTranslations,
          [targetLanguage]: translatedTitleText.trim(),
        };

        console.log(
          `Updating video ${videoId} with translated title for ${targetLanguage}: "${translatedTitleText.trim()}"`
        );
        const { error: updateError } = await supabase
          .from("videos")
          .update({ translated_titles: updatedTranslations } as any)
          .eq("id", videoId);

        if (updateError) {
          console.error(
            `DB Update Error for video ${videoId} translated title:`,
            updateError
          );
          throw new AppError(
            AppErrorCode.DATABASE_ERROR,
            `DB error updating translated title for video ${videoId}: ${updateError.message}`
          );
        }

        console.log(
          `Successfully translated and stored title for ${targetLanguage} for video ${videoId}.`
        );
        return {
          success: true,
          data: { translatedTitle: translatedTitleText.trim() },
        };
      } catch (error: unknown) {
        console.error(
          `Error translating title for video ${videoId} to ${targetLanguage}:`,
          error
        );
        const appErr =
          error instanceof AppError ? error : appErrors.UNEXPECTED_ERROR;
        return { success: false, error: appErr };
      }
    }
  );
