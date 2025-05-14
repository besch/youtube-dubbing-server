"use server";

import { z } from "zod";
import type { Tables } from "@/types/supabase";
import { protectedAction, publicAction } from "../safe-action";
import { supabaseServiceRoleClient } from "@/lib/supabase/serviceRoleClient";
import { ActionResponse, AppError, AppErrorCode } from "../actions";
import { config } from "@/config";
import { generateOpenAiTts } from "@/lib/openai-tts";
import { generateGoogleTts } from "@/lib/google-tts";
import { extractTextFromSegments } from "../video/utils";
import type { ReplicateSegmentOutput } from "@/lib/replicate";
import crypto from "crypto"; // For generating random part of filename

// --- Action: Generate Audio Chunk (Revised for Multi-TTS and On-the-Fly) ---
const generateAudioChunkSchema = z
  .object({
    videoId: z.string().optional(), // Made optional
    language: z.string(),
    voice: z.string(),
    startTime: z.number().min(0),
    endTime: z.number().min(0),
    text: z.string().optional(),
  })
  .refine((data) => data.endTime > data.startTime, {
    message: "End time must be greater than start time",
    path: ["endTime"],
  })
  .refine(
    (data) => {
      if (!data.text || data.text.trim() === "") {
        return !!data.videoId; // If no text, videoId is required
      }
      return true; // If text is provided, videoId is not strictly required by this refine
    },
    {
      message: "videoId is required when text is not provided",
      path: ["videoId"],
    }
  );

export const generateAudioChunk = publicAction
  .schema(generateAudioChunkSchema)
  .action(
    async ({ parsedInput }): Promise<ActionResponse<{ publicUrl: string }>> => {
      const {
        videoId: initialVideoId,
        language,
        voice,
        startTime,
        endTime,
        text,
      } = parsedInput;
      const supabase = supabaseServiceRoleClient;
      const isTextProvided = text && text.trim() !== "";

      let actualVideoUuid: string | undefined = undefined;
      let textToSynthesize: string = "";
      let chunkStoragePath: string;

      // --- Determine TTS Provider (common logic) ---
      let ttsProvider: "openai" | "google" | null = null;
      let googleLangCode: string | undefined;
      let googleVoiceName: string | undefined;
      let openaiVoiceName: string | undefined;

      const targetGoogleLangCode = config.google.simpleToGoogleMap[language];
      if (
        targetGoogleLangCode &&
        config.google.languages[targetGoogleLangCode]
      ) {
        const validGoogleVoices =
          config.google.languages[targetGoogleLangCode].voices;
        if (validGoogleVoices.some((v) => v.id === voice)) {
          ttsProvider = "google";
          googleLangCode = targetGoogleLangCode;
          googleVoiceName = voice;
        }
      }
      if (ttsProvider === null) {
        if (config.openai.voices.includes(voice)) {
          ttsProvider = "openai";
          openaiVoiceName = voice;
        } else {
          let errorMessage = `Voice '${voice}' is not a valid OpenAI voice.`;
          if (
            targetGoogleLangCode &&
            config.google.languages[targetGoogleLangCode]
          ) {
            const validGoogleVoicesList = config.google.languages[
              targetGoogleLangCode
            ].voices
              .map((v) => v.id)
              .join(", ");
            errorMessage += ` It's also not a valid Google voice for language '${language}'. Valid Google voices: ${validGoogleVoicesList}`;
          } else {
            errorMessage += ` Language '${language}' is also not supported by Google TTS.`;
          }
          return {
            success: false,
            error: new AppError(AppErrorCode.INVALID_INPUT, errorMessage),
          };
        }
      }
      if (!ttsProvider) {
        return {
          success: false,
          error: new AppError(
            AppErrorCode.UNEXPECTED_ERROR,
            `Failed to determine TTS provider for language '${language}' and voice '${voice}'.`
          ),
        };
      }
      // --- End Determine TTS Provider ---

      try {
        if (isTextProvided) {
          // Branch 1: Text is provided - On-the-fly generation, no DB writes for translated_audio_chunks
          console.log(
            `On-the-fly audio generation for Lang: ${language}, Voice: ${voice}. Provided text: "${text!.substring(
              0,
              100
            )}..."`
          );
          textToSynthesize = text!.trim();
          // Generate a unique path for on-the-fly audio. videoId is not used here for path generation.
          const randomSuffix = crypto.randomBytes(4).toString("hex");
          chunkStoragePath = `on-the-fly-audio/${language}/${voice}/${Date.now()}_${startTime}_${endTime}_${randomSuffix}.mp3`;
        } else {
          // Branch 2: Text is NOT provided - Use videoId, fetch transcriptions, save to DB
          if (!initialVideoId) {
            // Should be caught by refine, but as a safeguard
            return {
              success: false,
              error: new AppError(
                AppErrorCode.INVALID_INPUT,
                "videoId is required when text is not provided."
              ),
            };
          }
          console.log(
            `Video-associated audio generation for video: ${initialVideoId}, Lang: ${language}, Voice: ${voice}`
          );

          // Resolve initialVideoId to actual UUID
          if (z.string().uuid().safeParse(initialVideoId).success) {
            actualVideoUuid = initialVideoId;
          } else {
            const { data: videoData, error: videoError } = await supabase
              .from("videos")
              .select("id")
              .eq("youtube_id", initialVideoId)
              .single();
            if (videoError) {
              console.error(
                `Error fetching video UUID for youtube_id '${initialVideoId}':`,
                videoError
              );
              return {
                success: false,
                error: new AppError(
                  AppErrorCode.DATABASE_ERROR,
                  `Failed to resolve video ID: ${videoError.message}`
                ),
              };
            }
            if (!videoData) {
              return {
                success: false,
                error: new AppError(
                  AppErrorCode.RECORD_NOT_FOUND,
                  `Video with youtube_id '${initialVideoId}' not found.`
                ),
              };
            }
            actualVideoUuid = videoData.id;
            console.log(
              `Resolved '${initialVideoId}' to UUID '${actualVideoUuid}'.`
            );
          }

          // Check if exact chunk already exists in DB
          const { data: existingChunk, error: checkError } = await supabase
            .from("translated_audio_chunks")
            .select("storage_path")
            .eq("video_id", actualVideoUuid)
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
            console.log("Audio chunk already exists in DB. Fetching URL.");
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

          // Fetch transcription data
          const { data: segmentsDataUntyped, error: segmentsError } =
            await supabase
              .from("transcription_segments")
              .select("id, content, translations")
              .eq("video_id", actualVideoUuid)
              .eq("status", "completed")
              .single();

          if (segmentsError)
            throw new AppError(
              AppErrorCode.DATABASE_ERROR,
              `DB error fetching full transcription: ${segmentsError.message}`
            );
          const fullTranscriptionData =
            segmentsDataUntyped as Tables<"transcription_segments"> | null;
          if (!fullTranscriptionData)
            throw new AppError(
              AppErrorCode.RECORD_NOT_FOUND,
              "Completed full transcription not available for the video."
            );

          if (language === "en") {
            if (!fullTranscriptionData.content) {
              console.warn(
                `Original transcription content missing for video ${actualVideoUuid} needed for English TTS.`
              );
              throw new AppError(
                AppErrorCode.DEPENDENCY_NOT_READY,
                `Original transcription not ready for video ${actualVideoUuid}.`
              );
            }
            const replicateOutput =
              fullTranscriptionData.content as unknown as ReplicateSegmentOutput;
            textToSynthesize = extractTextFromSegments(
              [replicateOutput],
              startTime,
              endTime
            );
          } else {
            const translations = fullTranscriptionData.translations as Record<
              string,
              unknown
            > | null;
            const translationData = translations
              ? translations[language]
              : null;
            if (!translationData) {
              console.warn(
                `Translation for '${language}' not found for video ${actualVideoUuid}.`
              );
              throw new AppError(
                AppErrorCode.DEPENDENCY_NOT_READY,
                `Translation for '${language}' not ready for video ${actualVideoUuid}.`
              );
            }
            const translatedReplicateOutput =
              translationData as unknown as ReplicateSegmentOutput;
            textToSynthesize = extractTextFromSegments(
              [translatedReplicateOutput],
              startTime,
              endTime
            );
          }

          // Generate storage path for video-associated audio
          // Use actualVideoUuid in the path for organization if it's available
          const videoIdPart = actualVideoUuid || "unknown_video";
          chunkStoragePath = `${videoIdPart}/${language}/${voice}/${startTime}-${endTime}.mp3`;
        }

        if (!textToSynthesize.trim()) {
          throw new AppError(
            AppErrorCode.RECORD_NOT_FOUND,
            `No text found or generated for the time range ${startTime}-${endTime} in ${language}.`
          );
        }

        console.log(
          `Text for TTS (${ttsProvider}, ${language}, ${voice}, ${startTime}-${endTime}): "${textToSynthesize.substring(
            0,
            100
          )}..."`
        );

        let ttsResult: { audioBuffer: Buffer; storagePath: string };
        // The TTS functions generate their own storagePath based on videoId, etc.
        // For on-the-fly, we want to use the `chunkStoragePath` we defined.
        // For video-associated, the TTS functions might also create a similar path, which is fine.
        // We will primarily use the `chunkStoragePath` determined in the branches above for upload and DB record.

        if (ttsProvider === "google") {
          ttsResult = await generateGoogleTts({
            text: textToSynthesize,
            languageCode: googleLangCode!,
            voiceName: googleVoiceName!,
            videoId: actualVideoUuid || "on-the-fly-temp-id",
            startTime,
            endTime,
          });
        } else {
          // openai
          ttsResult = await generateOpenAiTts({
            text: textToSynthesize,
            voice: openaiVoiceName as any,
            videoId: actualVideoUuid || "on-the-fly-temp-id",
            language,
            startTime,
            endTime,
          });
        }

        // Use the specific chunkStoragePath determined earlier for upload
        const finalStoragePath = chunkStoragePath;
        const { audioBuffer } = ttsResult;

        console.log(`Uploading TTS chunk to: ${finalStoragePath}`);
        const { error: uploadError } = await supabase.storage
          .from("translated-audio")
          .upload(finalStoragePath, audioBuffer, {
            contentType: "audio/mpeg",
            upsert: true, // Upsert true for on-the-fly means if hash collision, it overwrites; for video-specific it's fine.
          });

        if (uploadError)
          throw new AppError(
            AppErrorCode.SUPABASE_STORAGE_ERROR,
            `TTS Upload failed: ${uploadError.message}`
          );
        console.log(`TTS chunk uploaded to: ${finalStoragePath}`);

        // Only insert into DB if it's NOT an on-the-fly request (i.e., text was not initially provided)
        if (!isTextProvided && actualVideoUuid) {
          const { error: dbInsertError } = await supabase
            .from("translated_audio_chunks")
            .insert({
              video_id: actualVideoUuid, // actualVideoUuid is guaranteed here
              language: language,
              voice: voice,
              chunk_start: startTime,
              chunk_end: endTime,
              storage_path: finalStoragePath, // Use the path it was uploaded to
            });

          if (dbInsertError && dbInsertError.code !== "23505") {
            console.error(
              "DB Error inserting translated chunk record:",
              dbInsertError.message
            );
            // Potentially re-throw or handle if this is critical even after successful upload
          } else if (dbInsertError?.code === "23505") {
            console.warn(
              `Race condition: translated_audio_chunk for ${finalStoragePath} inserted concurrently.`
            );
          }
        }

        const { data: finalUrlData, error: finalUrlError } =
          await supabase.storage
            .from("translated-audio")
            .createSignedUrl(finalStoragePath, 60 * 5);

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
