import { z } from "zod";
import { inngest } from "./client";
import { supabaseServiceRoleClient } from "@/lib/supabase/serviceRoleClient";
import { ActionResponse, AppError, AppErrorCode } from "@/app/actions/actions";
import { config } from "@/config";
import {
  formatTranscriptionForTranslation,
  parseTranslationResponse,
  translateText,
} from "@/lib/translate";
import type { ReplicateSegmentOutput } from "@/lib/replicate";
import type { Tables } from "@/types/supabase";
import { generateOpenAiTts } from "@/lib/openai-tts";
import { generateGoogleTts } from "@/lib/google-tts";

// --- Event Schemas --- //

export const TranslationRequestEventSchema = z.object({
  name: z.literal("translation/request"),
  data: z.object({
    segmentId: z.string().uuid(),
    targetLanguage: z.string().length(2),
  }),
});

export const TtsSpawnInitialEventSchema = z.object({
  name: z.literal("tts/spawn-initial"),
  data: z.object({
    videoId: z.string().uuid(),
    language: z.string(),
    voice: z.string(),
  }),
});

export const TtsGenerateChunkEventSchema = z.object({
  name: z.literal("tts/generate-chunk"),
  data: z.object({
    videoId: z.string().uuid(),
    language: z.string(),
    voice: z.string(),
    startTime: z.number().min(0),
    endTime: z.number().min(0),
    textToSynthesize: z.string(),
  }),
});

// --- Inngest Functions --- //

// Translation Job Handler
export const handleTranslationRequest = inngest.createFunction(
  { id: "handle-translation-request", name: "Handle Translation Request" },
  { event: "translation/request" }, // Triggered by this event
  async ({ event, step }) => {
    const { segmentId, targetLanguage } = event.data;
    const supabase = supabaseServiceRoleClient;
    const langVoiceKey = ``; // Need logic to determine relevant langVoiceKey if updating status
    let videoId: string | undefined;

    console.log(
      `INNGEST JOB: Translating content for segment row ${segmentId} to language: ${targetLanguage}`
    );

    try {
      // --- Fetch data (Retry Step) ---
      const segmentDataUntyped = await step.run(
        "fetch-transcription-data",
        async () => {
          const { data, error } = await supabase
            .from("transcription_segments")
            .select("id, content, translations, video_id") // Also fetch video_id
            .eq("id", segmentId)
            .single();

          if (error)
            throw new AppError(
              AppErrorCode.DATABASE_ERROR,
              `DB error fetching transcription ${segmentId}: ${error.message}`
            );
          return data;
        }
      );
      const segmentData = segmentDataUntyped as any;
      videoId = segmentData.video_id;

      console.log(
        `INNGEST JOB: Fetched segmentData for row ${segmentId}. Keys: ${Object.keys(
          segmentData
        )}`
      );

      const existingTranslations = (segmentData.translations ?? {}) as Record<
        string,
        ReplicateSegmentOutput
      >;

      const translationAlreadyExists =
        existingTranslations[targetLanguage] &&
        Array.isArray(existingTranslations[targetLanguage]?.segments) &&
        existingTranslations[targetLanguage].segments.length > 0;

      if (translationAlreadyExists) {
        console.log(
          `INNGEST JOB: Translation for ${targetLanguage} already exists for row ${segmentId}. Skipping actual translation.`
        );
        return { success: true, message: "Translation already existed" };
      }

      // --- Validate content ---
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
        console.error(
          `INNGEST JOB: Invalid 'content' structure in row ${segmentId}.`,
          segmentData.content
        );
        throw new AppError(
          AppErrorCode.INVALID_INPUT,
          `Transcription row ${segmentId} has invalid 'content' structure.`
        );
      }

      if (!originalContent?.segments || originalContent.segments.length === 0) {
        console.log(
          `INNGEST JOB: Transcription row ${segmentId} content is empty, skipping translation.`
        );
        return { success: true, message: "No content to translate" };
      }

      // --- Prepare for Translation ---
      const sourceLangCode = originalContent.detected_language || "en";
      const targetLangName =
        config.languages.find((l) => l.code === targetLanguage)?.name ||
        targetLanguage;

      if (sourceLangCode === targetLanguage) {
        console.log(
          `INNGEST JOB: Source and target language (${targetLanguage}) are the same for row ${segmentId}. Storing original as translation.`
        );
        const updatedTranslations = {
          ...existingTranslations,
          [targetLanguage]: originalContent,
        };
        await step.run("update-db-same-language", async () => {
          const { error: updateError } = await supabase
            .from("transcription_segments")
            .update({ translations: updatedTranslations } as any)
            .eq("id", segmentId);
          if (updateError) {
            console.error(
              `DB Error storing original as translation for ${segmentId}:`,
              updateError
            );
            // Don't fail the job for this? Maybe log and continue.
          }
        });
        return { success: true, message: "Stored original as translation" };
      }

      const textToTranslate = formatTranscriptionForTranslation(
        originalContent.segments
      );
      if (!textToTranslate) {
        console.log(
          `INNGEST JOB: No text found to translate in transcription row ${segmentId}.`
        );
        return { success: true, message: "No text to translate" };
      }

      // --- Call Translation Service (Retry Step) ---
      const translatedText = await step.run(
        "call-translation-api",
        async () => {
          const result = await translateText(textToTranslate, targetLangName);
          if (!result) {
            throw new AppError(
              AppErrorCode.SERVICE_ERROR,
              "Translation service returned empty response."
            );
          }
          return result;
        }
      );

      // --- Parse Response & Update DB (Retry Step) ---
      await step.run("parse-and-update-db", async () => {
        const parsedSegments = parseTranslationResponse(
          translatedText,
          originalContent!.segments
        );

        if (!parsedSegments || parsedSegments.length === 0) {
          throw new AppError(
            AppErrorCode.SERVICE_ERROR,
            `Failed to parse translation response or got empty segments for row ${segmentId}.`
          );
        }

        const translatedContent: ReplicateSegmentOutput = {
          segments: parsedSegments,
          detected_language: targetLanguage,
        };

        const updatedTranslations = {
          ...existingTranslations,
          [targetLanguage]: translatedContent,
        };

        console.log(
          `INNGEST JOB: Updating DB for row ${segmentId} with translation for language ${targetLanguage}.`
        );
        const { error: updateError } = await supabase
          .from("transcription_segments")
          .update({ translations: updatedTranslations } as any)
          .eq("id", segmentId);

        if (updateError) {
          console.error(
            `INNGEST JOB: DB Update Error for row ${segmentId}:`,
            updateError
          );
          throw new AppError(
            AppErrorCode.DATABASE_ERROR,
            `DB error updating translations for row ${segmentId}: ${updateError.message}`
          );
        }
        console.log(`INNGEST JOB: DB Update successful for row ${segmentId}.`);
      });

      return {
        success: true,
        message: `Translation for ${targetLanguage} completed.`,
      };
    } catch (error: unknown) {
      console.error(
        `INNGEST JOB FAILURE: Error translating content for row ${segmentId} to ${targetLanguage}:`,
        error
      );
      const appErr =
        error instanceof AppError
          ? error
          : new AppError(
              AppErrorCode.UNEXPECTED_ERROR,
              error instanceof Error
                ? error.message
                : "Unknown error during translation job"
            );

      // Attempt to update video status to failed
      await step.run("update-video-status-to-failed", async () => {
        // Check if videoId was successfully fetched before proceeding
        if (!videoId) {
          console.error(
            "Cannot update video status to failed: videoId was not determined from segmentData."
          );
          return;
        }

        // Fetch video status to find relevant lang_voice keys
        const { data: videoData, error: fetchVideoError } = await supabase
          .from("videos")
          .select("processing_status")
          .eq("id", videoId)
          .single();

        if (fetchVideoError || !videoData?.processing_status) {
          console.error(
            "Failed to fetch video status to mark translation as failed."
          );
          return; // Cannot update status
        }

        const currentStatus =
          (videoData.processing_status as Record<string, any>) || {};
        const updatedStatus = { ...currentStatus };
        let statusUpdated = false;

        for (const key in updatedStatus) {
          if (key.startsWith(`${targetLanguage}_`)) {
            // Find keys for the failed language
            updatedStatus[key] = {
              ...(updatedStatus[key] || {}),
              status: "failed",
              error_message: `Translation failed: ${appErr.message}`,
              last_updated: new Date().toISOString(),
            };
            statusUpdated = true;
          }
        }

        if (statusUpdated) {
          const { error: updateVidError } = await supabase
            .from("videos")
            .update({ processing_status: updatedStatus })
            .eq("id", videoId);
          if (updateVidError) {
            console.error(
              "Failed to update video status to failed after translation error:",
              updateVidError
            );
          }
        }
      });

      // Throw the error to signal Inngest to retry or mark as failed
      throw appErr;
    }
  }
);

// TTS Initial Spawning Job Handler
export const handleTtsSpawnInitial = inngest.createFunction(
  { id: "handle-tts-spawn-initial", name: "Handle Initial TTS Spawning" },
  { event: "tts/spawn-initial" },
  async ({ event, step }) => {
    const { videoId, language, voice } = event.data;
    const supabase = supabaseServiceRoleClient;
    const langVoiceKey = `${language}_${voice}`;

    console.log(
      `INNGEST JOB: Spawning initial TTS jobs for Video: ${videoId}, Lang: ${language}, Voice: ${voice}`
    );

    try {
      // --- Fetch transcription/translation data (Retry Step) ---
      const transcriptionData = await step.run(
        "fetch-transcription-for-tts-spawn",
        async () => {
          const { data, error } = await supabase
            .from("transcription_segments")
            .select("id, content, translations")
            .eq("video_id", videoId)
            .eq("status", "completed")
            .single();
          if (error) {
            throw new AppError(
              AppErrorCode.DATABASE_ERROR,
              `DB error fetching transcription for TTS spawn: ${error.message}`
            );
          }
          return data as any; // Cast for simplicity
        }
      );

      // --- Extract relevant segments ---
      let sourceSegments:
        | ReplicateSegmentOutput["segments"]
        | undefined
        | null = null;
      if (language === "en") {
        const originalContent =
          transcriptionData.content as ReplicateSegmentOutput | null;
        sourceSegments = originalContent?.segments;
        if (!sourceSegments)
          throw new AppError(
            AppErrorCode.DEPENDENCY_NOT_READY,
            `Original transcription content missing for ${videoId} (EN).`
          );
      } else {
        const translatedContent = transcriptionData.translations?.[
          language
        ] as ReplicateSegmentOutput | null;
        sourceSegments = translatedContent?.segments;
        if (!sourceSegments)
          throw new AppError(
            AppErrorCode.DEPENDENCY_NOT_READY,
            `Translation '${language}' not found for ${videoId}.`
          );
      }

      if (!sourceSegments || sourceSegments.length === 0) {
        console.log(
          `INNGEST JOB: No segments found for ${language}. No TTS jobs to trigger.`
        );
        return { success: true, jobsTriggered: 0 };
      }

      // --- Filter initial segments (<= 60s) ---
      const validSegmentsToProcess = sourceSegments.filter(
        (subSegment) =>
          subSegment.start !== undefined &&
          subSegment.end !== undefined &&
          subSegment.text?.trim() &&
          subSegment.end > subSegment.start &&
          subSegment.end <= 60 // Only initial segments
      );

      if (validSegmentsToProcess.length === 0) {
        console.log(
          `INNGEST JOB: No valid segments found <= 60s for ${language}. No TTS jobs to trigger.`
        );
        // Need to mark as completed? The on-audio-chunk trigger handles this.
        return { success: true, jobsTriggered: 0 };
      }

      // --- Enqueue individual chunk generation jobs (using step.sendEvent for potential batching/control) ---
      const eventsToSend = validSegmentsToProcess.map((subSegment) => {
        return {
          name: "tts/generate-chunk", // Ensure this matches the event name
          data: {
            videoId: videoId,
            language: language,
            voice: voice,
            startTime: subSegment.start!,
            endTime: subSegment.end!,
            textToSynthesize: subSegment.text!.trim(),
          },
        };
      });

      await step.sendEvent("enqueue-tts-chunk-jobs", eventsToSend);

      console.log(
        `INNGEST JOB: Finished spawning ${eventsToSend.length} initial TTS jobs for ${videoId}, ${language}, ${voice}.`
      );

      return { success: true, jobsTriggered: eventsToSend.length };
    } catch (error: unknown) {
      console.error(
        `INNGEST JOB FAILURE: Error spawning TTS jobs for ${videoId}, ${language}, ${voice}:`,
        error
      );
      const appErr =
        error instanceof AppError
          ? error
          : new AppError(
              AppErrorCode.UNEXPECTED_ERROR,
              error instanceof Error
                ? error.message
                : "Unknown error spawning TTS jobs"
            );

      // Attempt to update video status to failed
      await step.run("update-video-status-failed-spawn", async () => {
        try {
          const { data: videoData, error: fetchError } = await supabase
            .from("videos")
            .select("processing_status")
            .eq("id", videoId)
            .single();
          if (!fetchError && videoData) {
            const currentStatus =
              (videoData.processing_status as Record<string, any>) || {};
            const updatedStatus = {
              ...currentStatus,
              [langVoiceKey]: {
                ...(currentStatus[langVoiceKey] || {}),
                status: "failed",
                error_message: `Failed to spawn initial TTS jobs: ${appErr.message}`,
                last_updated: new Date().toISOString(),
              },
            };
            await supabase
              .from("videos")
              .update({ processing_status: updatedStatus })
              .eq("id", videoId);
          }
        } catch (e) {
          console.error(
            "Failed attempt to update video status on spawn failure:",
            e
          );
        }
      });

      throw appErr; // Signal failure to Inngest
    }
  }
);

// TTS Chunk Generation Job Handler
export const handleTtsGenerateChunk = inngest.createFunction(
  { id: "handle-tts-generate-chunk", name: "Handle TTS Chunk Generation" },
  { event: "tts/generate-chunk" },
  async ({ event, step }) => {
    const { videoId, language, voice, startTime, endTime, textToSynthesize } =
      event.data;
    const supabase = supabaseServiceRoleClient;

    console.log(
      `INNGEST JOB: Generating audio chunk for ${videoId}, ${language}, ${voice}, ${startTime}-${endTime}`
    );

    try {
      // --- TTS Provider Selection Logic (Copied from internalGenerateAudioChunk) ---
      let ttsProvider: "openai" | "google";
      let googleLangCode: string | undefined;
      let googleVoiceName: string | undefined;
      let openaiVoiceName: string | undefined;

      if (config.openai.voices.includes(voice)) {
        ttsProvider = "openai";
        openaiVoiceName = voice;
      } else {
        const targetGoogleLangCode = config.google.simpleToGoogleMap[language];
        if (
          targetGoogleLangCode &&
          config.google.languages[targetGoogleLangCode]
        ) {
          ttsProvider = "google";
          googleLangCode = targetGoogleLangCode;
          const validGoogleVoices =
            config.google.languages[googleLangCode].voices;
          if (!validGoogleVoices.some((v) => v.id === voice)) {
            throw new AppError(
              AppErrorCode.INVALID_INPUT,
              `Invalid Google voice '${voice}' for lang '${language}'.`
            );
          }
          googleVoiceName = voice;
        } else {
          throw new AppError(
            AppErrorCode.INVALID_INPUT,
            `Voice '${voice}' invalid or lang '${language}' not supported.`
          );
        }
      }
      // --- End TTS Provider Selection ---

      if (!textToSynthesize) {
        console.log(
          `INNGEST JOB: Skipping chunk ${startTime}-${endTime} due to empty text.`
        );
        return {
          success: true,
          storagePath: "",
          message: "Skipped empty text",
        };
      }

      // --- Call TTS API (Retry Step) ---
      const ttsResult = await step.run("call-tts-api", async () => {
        let result: { audioBuffer: Buffer; storagePath: string };
        if (ttsProvider === "google") {
          result = await generateGoogleTts({
            text: textToSynthesize,
            languageCode: googleLangCode!,
            voiceName: googleVoiceName!,
            videoId,
            startTime,
            endTime,
          });
        } else {
          result = await generateOpenAiTts({
            text: textToSynthesize,
            voice: openaiVoiceName as any,
            videoId,
            language,
            startTime,
            endTime,
          });
        }
        return result;
      });

      const { audioBuffer, storagePath: chunkStoragePath } = ttsResult;

      // --- Upload TTS chunk (Retry Step) ---
      await step.run("upload-tts-chunk", async () => {
        const { error: uploadError } = await supabase.storage
          .from("translated-audio")
          // Cast Buffer. Ensure Buffer is compatible or use appropriate conversion.
          .upload(chunkStoragePath, audioBuffer as any, {
            // Using 'as any' - verify compatibility
            contentType: "audio/mpeg",
            upsert: true,
          });

        if (uploadError) {
          throw new AppError(
            AppErrorCode.SUPABASE_STORAGE_ERROR,
            `TTS Upload failed for ${chunkStoragePath}: ${uploadError.message}`
          );
        }
      });

      // --- Insert DB Record (Retry Step - with race condition handling) ---
      await step.run("insert-chunk-record", async () => {
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

        if (dbInsertError) {
          // Check for unique constraint violation (race condition or retry after success)
          if (dbInsertError.code === "23505") {
            console.warn(
              `INNGEST JOB: Handled Race condition/Retry: Chunk DB record for ${chunkStoragePath} already exists.`
            );
            // Don't throw, consider it success as the record exists
          } else {
            // It's some other database error
            console.error(
              "INNGEST JOB: DB Error inserting translated chunk record:",
              dbInsertError.message
            );
            throw new AppError(
              AppErrorCode.DATABASE_ERROR,
              `DB error inserting chunk record: ${dbInsertError.message}`
            );
          }
        }
      });

      console.log(
        `INNGEST JOB: Successfully generated chunk ${chunkStoragePath}`
      );
      return { success: true, storagePath: chunkStoragePath };
    } catch (error: unknown) {
      console.error(
        `INNGEST JOB FAILURE: Error generating chunk ${startTime}-${endTime}:`,
        error
      );
      const appErr =
        error instanceof AppError
          ? error
          : new AppError(
              AppErrorCode.UNEXPECTED_ERROR,
              error instanceof Error
                ? error.message
                : "Unknown error generating audio chunk"
            );
      // Don't update video status to failed for single chunk errors,
      // just let Inngest handle retries/failure for this job.
      throw appErr; // Signal failure to Inngest
    }
  }
);
