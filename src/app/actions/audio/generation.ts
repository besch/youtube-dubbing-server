"use server";

import { z } from "zod";
import type { Tables } from "@/types/supabase";
import { protectedAction } from "../safe-action";
import { supabaseServiceRoleClient } from "@/lib/supabase/serviceRoleClient";
import { ActionResponse, AppError, AppErrorCode } from "../actions";
import { config } from "@/config";
import { generateOpenAiTts } from "@/lib/openai-tts";
import { generateGoogleTts } from "@/lib/google-tts";
import { extractTextFromSegments } from "../video/utils";
import type { ReplicateSegmentOutput } from "@/lib/replicate";

// --- Action: Generate Audio Chunk (Revised for Multi-TTS) ---
const generateAudioChunkSchema = z
  .object({
    videoId: z.string().uuid(),
    language: z.string(), // Simple language code (e.g., "en", "de")
    voice: z.string(), // Voice identifier (e.g., "alloy", "en-US-Standard-A")
    startTime: z.number().min(0),
    endTime: z.number().min(0),
  })
  .refine((data) => data.endTime > data.startTime, {
    message: "End time must be greater than start time",
    path: ["endTime"],
  });

export const generateAudioChunk = protectedAction
  .schema(generateAudioChunkSchema)
  .action(
    async ({ parsedInput }): Promise<ActionResponse<{ publicUrl: string }>> => {
      const { videoId, language, voice, startTime, endTime } = parsedInput;
      const supabase = supabaseServiceRoleClient;

      let ttsProvider: "openai" | "google" | null = null; // Allow null initially
      let googleLangCode: string | undefined;
      let googleVoiceName: string | undefined;
      let openaiVoiceName: string | undefined;

      // --- Try Google TTS First ---
      const targetGoogleLangCode = config.google.simpleToGoogleMap[language];
      if (
        targetGoogleLangCode &&
        config.google.languages[targetGoogleLangCode]
      ) {
        // Language IS supported by Google TTS
        const validGoogleVoices =
          config.google.languages[targetGoogleLangCode].voices;
        if (validGoogleVoices.some((v) => v.id === voice)) {
          // Voice IS a valid Google voice for this language
          ttsProvider = "google";
          googleLangCode = targetGoogleLangCode;
          googleVoiceName = voice;
          console.log(
            `Using Google TTS (Priority) for language: ${language} (${googleLangCode}), voice: ${googleVoiceName}`
          );
        } else {
          // Language supported by Google, but the specific voice is not valid for it.
          // Will proceed to check OpenAI below.
          console.log(
            `Voice '${voice}' is not a valid Google voice for language '${language}' (${targetGoogleLangCode}). Checking OpenAI as fallback.`
          );
        }
      } else {
        // Language is NOT supported by Google TTS.
        // Will proceed to check OpenAI below.
        console.log(
          `Language '${language}' not supported by Google TTS. Checking OpenAI.`
        );
      }

      // --- Fallback to OpenAI TTS if Google wasn't chosen ---
      if (ttsProvider === null) {
        if (config.openai.voices.includes(voice)) {
          ttsProvider = "openai";
          openaiVoiceName = voice; // Use the provided voice as the OpenAI voice name
          console.log(
            `Using OpenAI TTS (Fallback) for voice: ${openaiVoiceName}`
          );
        } else {
          // If Google wasn't suitable AND it's not a valid OpenAI voice, then it's an error.
          // Construct a more informative error message based on why Google failed (if it did)
          let errorMessage = `Voice '${voice}' is not a valid OpenAI voice.`;
          if (
            targetGoogleLangCode &&
            config.google.languages[targetGoogleLangCode]
          ) {
            // Google language was supported, but voice was invalid
            const validGoogleVoicesList = config.google.languages[
              targetGoogleLangCode
            ].voices
              .map((v) => v.id)
              .join(", ");
            errorMessage += ` It's also not a valid Google voice for language '${language}'. Valid Google voices: ${validGoogleVoicesList}`;
          } else {
            // Google language wasn't supported
            errorMessage += ` Language '${language}' is also not supported by Google TTS.`;
          }

          return {
            success: false,
            error: new AppError(AppErrorCode.INVALID_INPUT, errorMessage),
          };
        }
      }

      // --- Proceed with selected provider ---
      if (!ttsProvider) {
        // Should be logically impossible to reach here due to checks above, but safeguard.
        return {
          success: false,
          error: new AppError(
            AppErrorCode.UNEXPECTED_ERROR,
            `Failed to determine TTS provider for language '${language}' and voice '${voice}'.`
          ),
        };
      }

      console.log(
        `Generating audio chunk for: ${videoId}, Lang: ${language}, Voice: ${voice}, Time: ${startTime}-${endTime} using ${ttsProvider}`
      );

      try {
        // Check if exact chunk already exists
        const { data: existingChunk, error: checkError } = await supabase
          .from("translated_audio_chunks")
          .select("storage_path")
          .eq("video_id", videoId)
          .eq("language", language)
          .eq("voice", voice)
          .eq("chunk_start", startTime)
          .eq("chunk_end", endTime)
          .maybeSingle();

        if (checkError)
          throw new AppError(
            AppErrorCode.DATABASE_ERROR,
            `DB error checking chunk: ${checkError.message}`
          );

        const existingPath = (
          existingChunk as Tables<"translated_audio_chunks"> | null
        )?.storage_path;
        if (existingPath) {
          console.log("Audio chunk already exists. Fetching URL.");
          const { data: urlData, error: urlError } = await supabase.storage
            .from("translated-audio")
            .createSignedUrl(existingPath, 60 * 5);
          if (urlError)
            throw new AppError(
              AppErrorCode.SUPABASE_STORAGE_ERROR,
              `Sign URL error: ${urlError.message}`
            );
          if (!urlData?.signedUrl)
            throw new AppError(
              AppErrorCode.SUPABASE_STORAGE_ERROR,
              "Signed URL creation returned null."
            );
          return { success: true, data: { publicUrl: urlData.signedUrl } };
        }

        // Fetch relevant COMPLETED transcription segments
        const { data: segmentsDataUntyped, error: segmentsError } =
          await supabase
            .from("transcription_segments")
            .select("id, start_time, end_time, content, translations") // Include content for EN
            .eq("video_id", videoId)
            .eq("status", "completed")
            .lte("start_time", endTime)
            .gte("end_time", startTime)
            .order("start_time", { ascending: true });

        if (segmentsError)
          throw new AppError(
            AppErrorCode.DATABASE_ERROR,
            `DB error fetching segments: ${segmentsError.message}`
          );

        const segmentsData = segmentsDataUntyped as any[] | null;

        if (!segmentsData || segmentsData.length === 0) {
          throw new AppError(
            AppErrorCode.RECORD_NOT_FOUND,
            "Completed transcription not available for the requested time."
          );
        }

        // Extract Text for the Specific Time Range & Language
        let textToSynthesize = "";
        if (language === "en") {
          const originalContents: ReplicateSegmentOutput[] = [];
          for (const segment of segmentsData) {
            if (!segment.content) {
              console.warn(
                `Original transcription content missing for segment ${segment.id} (${segment.start_time}-${segment.end_time}) needed for English TTS.`
              );
              throw new AppError(
                AppErrorCode.DEPENDENCY_NOT_READY,
                `Original transcription not ready for time ${segment.start_time}s.`
              );
            }
            originalContents.push(segment.content as ReplicateSegmentOutput);
          }
          textToSynthesize = extractTextFromSegments(
            originalContents,
            startTime,
            endTime
          );
        } else {
          const translatedContents: ReplicateSegmentOutput[] = [];
          for (const segment of segmentsData) {
            const translation = segment.translations?.[language];
            if (!translation) {
              console.warn(
                `Translation for '${language}' not found for segment ${segment.id} (${segment.start_time}-${segment.end_time}).`
              );
              if (!segment.content) {
                throw new AppError(
                  AppErrorCode.DEPENDENCY_NOT_READY,
                  `Neither original transcription nor translation for '${language}' ready for time ${segment.start_time}s.`
                );
              } else {
                throw new AppError(
                  AppErrorCode.DEPENDENCY_NOT_READY,
                  `Translation for '${language}' not ready for time ${segment.start_time}s.`
                );
              }
            }
            translatedContents.push(translation as ReplicateSegmentOutput);
          }
          textToSynthesize = extractTextFromSegments(
            translatedContents,
            startTime,
            endTime
          );
        }

        if (!textToSynthesize.trim()) {
          throw new AppError(
            AppErrorCode.RECORD_NOT_FOUND,
            `No text found for the time range ${startTime}-${endTime} in ${language}.`
          );
        }

        console.log(
          `Text for TTS (${ttsProvider}, ${language}, ${voice}, ${startTime}-${endTime}): "${textToSynthesize.substring(
            0,
            100
          )}..."`
        );

        // Call appropriate TTS function
        let ttsResult: { audioBuffer: Buffer; storagePath: string };
        if (ttsProvider === "google") {
          ttsResult = await generateGoogleTts({
            text: textToSynthesize,
            languageCode: googleLangCode!,
            voiceName: googleVoiceName!,
            videoId,
            startTime,
            endTime,
          });
        } else {
          ttsResult = await generateOpenAiTts({
            text: textToSynthesize,
            voice: openaiVoiceName as any,
            videoId,
            language,
            startTime,
            endTime,
          });
        }

        const { audioBuffer, storagePath: chunkStoragePath } = ttsResult;

        // Upload TTS chunk
        console.log(`Uploading TTS chunk to: ${chunkStoragePath}`);
        const { error: uploadError } = await supabase.storage
          .from("translated-audio")
          .upload(chunkStoragePath, audioBuffer, {
            contentType: "audio/mpeg",
            upsert: true,
          });

        if (uploadError)
          throw new AppError(
            AppErrorCode.SUPABASE_STORAGE_ERROR,
            `TTS Upload failed: ${uploadError.message}`
          );
        console.log(`TTS chunk uploaded to: ${chunkStoragePath}`);

        // Insert record into translated_audio_chunks
        const { error: dbInsertError } = await supabase
          .from("translated_audio_chunks")
          .insert({
            video_id: videoId,
            language: language,
            voice: voice,
            chunk_start: startTime,
            chunk_end: endTime,
            storage_path: chunkStoragePath,
          });

        if (dbInsertError && dbInsertError.code !== "23505") {
          console.error(
            "DB Error inserting translated chunk record:",
            dbInsertError.message
          );
        } else if (dbInsertError?.code === "23505") {
          console.warn(
            `Race condition: translated_audio_chunk for ${chunkStoragePath} inserted concurrently.`
          );
        }

        // Get signed URL for the chunk
        const { data: finalUrlData, error: finalUrlError } =
          await supabase.storage
            .from("translated-audio")
            .createSignedUrl(chunkStoragePath, 60 * 5); // 5 minute expiry

        if (finalUrlError)
          throw new AppError(
            AppErrorCode.SUPABASE_STORAGE_ERROR,
            `Sign URL failed: ${finalUrlError.message}`
          );
        if (!finalUrlData?.signedUrl)
          throw new AppError(
            AppErrorCode.SUPABASE_STORAGE_ERROR,
            "Signed URL creation returned null (final)."
          );

        console.log(`Returning chunk URL: ${finalUrlData.signedUrl}`);
        return { success: true, data: { publicUrl: finalUrlData.signedUrl } };
      } catch (error: unknown) {
        console.error("Error generating audio chunk:", error);
        const appErr =
          error instanceof AppError
            ? error
            : new AppError(
                AppErrorCode.UNEXPECTED_ERROR,
                error instanceof Error
                  ? error.message
                  : "Unknown error in generateAudioChunk"
              );
        return { success: false, error: appErr };
      }
    }
  );

// --- Action: Get Completed Audio Chunks ---
const getCompletedAudioChunksSchema = z.object({
  videoId: z.string().uuid(),
  language: z.string(),
  voice: z.string(),
});

interface CompletedAudioChunkOutput {
  storagePath: string;
  publicUrl: string;
  startTime: number;
  endTime: number;
  durationMs?: number | null;
}

export const getCompletedAudioChunks = protectedAction
  .schema(getCompletedAudioChunksSchema)
  .action(
    async ({
      parsedInput,
    }): Promise<ActionResponse<CompletedAudioChunkOutput[]>> => {
      const { videoId, language, voice } = parsedInput;
      const supabase = supabaseServiceRoleClient;

      console.log(
        `Fetching completed audio chunks for: ${videoId}, Lang: ${language}, Voice: ${voice}`
      );

      try {
        const { data: chunks, error: fetchError } = await supabase
          .from("translated_audio_chunks")
          .select("id, storage_path, chunk_start, chunk_end")
          .eq("video_id", videoId)
          .eq("language", language)
          .eq("voice", voice)
          .order("chunk_start", { ascending: true });

        if (fetchError) {
          throw new AppError(
            AppErrorCode.DATABASE_ERROR,
            `DB error fetching audio chunks: ${fetchError.message}`
          );
        }

        if (!chunks || chunks.length === 0) {
          console.log("No completed audio chunks found.");
          return { success: true, data: [] };
        }

        const signedUrlPromises = chunks.map(async (chunk) => {
          const { data: urlData, error: urlError } = await supabase.storage
            .from("translated-audio")
            .createSignedUrl(chunk.storage_path, 60 * 5);

          if (urlError || !urlData?.signedUrl) {
            console.error(
              `Failed to create signed URL for chunk ${chunk.id} (${chunk.storage_path}): ${urlError?.message}`
            );
            return null;
          }

          return {
            storagePath: chunk.storage_path,
            publicUrl: urlData.signedUrl,
            startTime: chunk.chunk_start,
            endTime: chunk.chunk_end,
          };
        });

        const resultsWithNulls = await Promise.all(signedUrlPromises);
        const finalResults = resultsWithNulls.filter(
          (result): result is CompletedAudioChunkOutput => result !== null
        );

        console.log(`Found and signed ${finalResults.length} audio chunks.`);
        return { success: true, data: finalResults };
      } catch (error: unknown) {
        console.error("Error fetching completed audio chunks:", error);
        const appErr =
          error instanceof AppError
            ? error
            : new AppError(
                AppErrorCode.UNEXPECTED_ERROR,
                error instanceof Error
                  ? error.message
                  : "Unknown error fetching audio chunks"
              );
        return { success: false, error: appErr };
      }
    }
  );
