"use server";

import { z } from "zod";
import { publicAction } from "./safe-action"; // Import publicAction
import { supabaseServiceRoleClient } from "@/lib/supabase/serviceRoleClient";
import { ActionResponse, AppError, AppErrorCode } from "./actions";
import { startReplicateTranscription } from "@/lib/replicate";
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
import { inngest } from "@/inngest/client"; // Import Inngest client
import {
  TranslationRequestEventSchema,
  TtsSpawnInitialEventSchema,
  TtsGenerateChunkEventSchema,
} from "@/inngest/functions"; // Import event schemas for type safety (optional but recommended)

// --- Helper Function: Extract Text from Segments for Time Range ---
// NOTE: This function might need adjustments later depending on how
// internalGenerateAudioChunk uses it with the full transcription data.
function extractTextFromSegments(
  segmentsOutputs: (ReplicateSegmentOutput | null | undefined)[],
  targetStartTime: number,
  targetEndTime: number
): string {
  let extractedText = "";
  const addedSentences = new Set<string>();

  for (const output of segmentsOutputs) {
    if (output?.segments) {
      for (const sentence of output.segments) {
        const sentenceStart = sentence?.start ?? -1;
        const sentenceEnd = sentence?.end ?? -1;
        const sentenceText = sentence?.text?.trim() ?? "";

        if (
          sentenceStart >= 0 &&
          sentenceEnd >= 0 &&
          sentenceText &&
          !addedSentences.has(sentenceText)
        ) {
          // Check for overlap between sentence time and target time range
          if (
            Math.max(sentenceStart, targetStartTime) <
            Math.min(sentenceEnd, targetEndTime)
          ) {
            extractedText += sentenceText + " ";
            addedSentences.add(sentenceText);
          }
        }
      }
    }
  }
  return extractedText.trim();
}
// --- End Helper Function --- //

// --- Helper: Trigger Internal Action via API ---
// Replicates the logic used by Supabase functions to call internal Next.js actions
async function triggerInternalAction(actionName: string, payload: any) {
  const actionUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/internal/trigger-action`;
  const functionSecret = process.env.SUPABASE_FUNCTION_SECRET;

  if (!process.env.NEXT_PUBLIC_APP_URL || !functionSecret) {
    console.error(
      "triggerInternalAction: NEXT_PUBLIC_APP_URL or SUPABASE_FUNCTION_SECRET env variables are not set."
    );
    // Don't throw here, let the caller handle potential failures gracefully
    // Throwing might stop spawning other jobs
    return { success: false, error: "Internal trigger configuration missing." };
  }

  try {
    console.log(
      `Triggering internal action '${actionName}'... Payload keys:`,
      Object.keys(payload)
    );
    const response = await fetch(actionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${functionSecret}`,
      },
      body: JSON.stringify({ actionName, payload }),
    });

    // Check if the fetch itself failed
    if (!response.ok) {
      const errorBody = await response.text();
      console.error(
        `triggerInternalAction: Error calling action '${actionName}': ${response.status} ${response.statusText}`,
        errorBody
      );
      return {
        success: false,
        error: `Failed to trigger action '${actionName}': ${response.status}`,
      };
    }

    // Check the response body from the API route
    const result = await response.json();
    if (!result.success) {
      console.error(
        `triggerInternalAction: Internal action ${actionName} execution failed:`,
        result.error
      );
      return {
        success: false,
        error: result.error ?? `Internal action ${actionName} failed.`,
      };
    }

    console.log(`Successfully triggered internal action '${actionName}'.`);
    return { success: true };
  } catch (error: any) {
    console.error(
      `triggerInternalAction: Fetch error calling action '${actionName}':`,
      error
    );
    return { success: false, error: error.message ?? "Unknown fetch error" };
  }
}
// --- End Helper ---

// --- Action: Internal Request FULL Transcription ---
const internalRequestFullTranscriptionSchema = z.object({
  videoId: z.string().uuid(),
  audioStoragePath: z.string().min(1, "Audio storage path cannot be empty"), // Path from download_jobs
});

// Use publicAction - no user context needed
export const internalRequestFullTranscription = publicAction
  .schema(internalRequestFullTranscriptionSchema)
  .action(
    async ({ parsedInput }): Promise<ActionResponse<{ success: boolean }>> => {
      const { videoId, audioStoragePath } = parsedInput;
      const supabase = supabaseServiceRoleClient; // Use service role client directly

      console.log(
        `INTERNAL ACTION: Requesting FULL transcription for video ${videoId} using audio path: ${audioStoragePath}`
      );

      try {
        // === STEP 1: Fetch Video Duration ===
        console.log(`[TryBlock] 1. Fetching video duration for ${videoId}...`);
        const { data: videoData, error: videoError } = await supabase
          .from("videos")
          .select("duration")
          .eq("id", videoId)
          .single();

        if (videoError)
          throw new AppError(
            AppErrorCode.DATABASE_ERROR,
            `DB error fetching video ${videoId}: ${videoError.message}`
          );
        if (
          !videoData ||
          typeof videoData.duration !== "number" ||
          videoData.duration <= 0
        )
          throw new AppError(
            AppErrorCode.RECORD_NOT_FOUND,
            `Video ${videoId} not found or duration is invalid (${videoData?.duration}).`
          );

        const videoDuration = videoData.duration;
        console.log(
          `[TryBlock] 1. Fetched duration: ${videoDuration} for ${videoId}`
        );

        // === STEP 2: Check Existing Transcription ===
        console.log(
          `[TryBlock] 2. Checking for existing transcription record for ${videoId}...`
        );
        const { data: existingTranscription, error: checkError } =
          await supabase
            .from("transcription_segments") // Still using this table name
            .select("id, status")
            .eq("video_id", videoId) // Check only by video_id
            .maybeSingle();

        if (checkError) {
          throw new AppError(
            AppErrorCode.DATABASE_ERROR,
            `DB error checking transcription: ${checkError.message}`
          );
        }

        let dbSegmentId: string | undefined; // ID of the single transcription row
        let shouldProceed = true;

        if (existingTranscription) {
          if (
            existingTranscription.status === "completed" ||
            existingTranscription.status === "processing"
          ) {
            console.log(
              `RequestFullTranscription: Found existing transcription for ${videoId}. Status: ${existingTranscription.status}. Skipping.`
            );
            shouldProceed = false;
          } else {
            console.log(
              `RequestFullTranscription: Found existing transcription for ${videoId} with status '${existingTranscription.status}'. Proceeding to update and start Replicate job.`
            );
            dbSegmentId = existingTranscription.id;
          }
        }

        console.log(
          `[TryBlock] 2. Existing transcription check complete. Status: ${existingTranscription?.status}, ShouldProceed: ${shouldProceed}`
        );

        if (!shouldProceed) {
          return { success: true, data: { success: true } };
        }

        // === STEP 3: Get Signed URL ===
        console.log(
          `[TryBlock] 3. Getting signed URL for ${audioStoragePath}...`
        );
        const fullAudioBucket = "youtube-audio";
        const { data: urlData, error: urlError } = await supabase.storage
          .from(fullAudioBucket)
          .createSignedUrl(audioStoragePath, 60 * 15); // Increased expiry to 15 mins for potentially large files

        if (urlError)
          throw new AppError(
            AppErrorCode.SUPABASE_STORAGE_ERROR,
            `Failed to get signed URL for ${audioStoragePath}: ${urlError.message}`
          );
        if (!urlData?.signedUrl)
          throw new AppError(
            AppErrorCode.SUPABASE_STORAGE_ERROR,
            "Signed URL creation returned no URL."
          );
        const fullAudioSignedUrl = urlData.signedUrl;
        console.log(`[TryBlock] 3. Got signed URL for ${audioStoragePath}`);

        // === STEP 4: Ensure DB Record ===
        // Declare variables before logging
        const transcriptionStartTime = 0;
        const transcriptionEndTime = videoDuration;
        console.log(
          `[TryBlock] 4. Ensuring DB record exists for transcription ${videoId} (${transcriptionStartTime}-${transcriptionEndTime})...`
        );

        if (!dbSegmentId) {
          // Insert new row
          console.log(
            `RequestFullTranscription: Inserting new transcription row for video ${videoId}`
          );
          const { data: dbSegment, error: insertError } = await supabase
            .from("transcription_segments")
            .insert({
              video_id: videoId,
              start_time: transcriptionStartTime,
              end_time: transcriptionEndTime,
              status: "pending",
            })
            .select("id")
            .single();

          if (insertError && insertError.code === "23505") {
            // 23505 = unique_violation
            console.warn(
              `Race condition inserting transcription row for ${videoId}. Fetching existing ID.`
            );
            const { data: raceSegment, error: raceError } = await supabase
              .from("transcription_segments")
              .select("id")
              .eq("video_id", videoId) // Fetch by video_id
              .single();
            if (raceError || !raceSegment) {
              throw new AppError(
                AppErrorCode.DATABASE_ERROR,
                `Failed to fetch transcription row after insert race condition: ${
                  raceError?.message || "Not Found"
                }`
              );
            }
            dbSegmentId = raceSegment.id;
            console.log(
              `[TryBlock] 4. Inserted/Found DB segment ID: ${dbSegmentId}`
            );
          } else if (insertError) {
            throw new AppError(
              AppErrorCode.DATABASE_ERROR,
              `DB error inserting transcription row: ${insertError.message}`
            );
          } else if (!dbSegment) {
            throw new AppError(
              AppErrorCode.DATABASE_ERROR,
              "Failed to insert transcription row or get ID."
            );
          } else {
            dbSegmentId = dbSegment.id;
            console.log(
              `[TryBlock] 4. Inserted/Found DB segment ID: ${dbSegmentId}`
            );
          }
        } else {
          console.log(
            `RequestFullTranscription: Using existing transcription row with ID: ${dbSegmentId}`
          );
        }

        // === STEP 5: Start Replicate ===
        console.log(
          `[TryBlock] 5. Starting Replicate transcription for row ${dbSegmentId}...`
        );
        const replicatePredictionId = await startReplicateTranscription(
          fullAudioSignedUrl
        );
        console.log(
          `[TryBlock] 5. Replicate started. Prediction ID: ${replicatePredictionId}`
        );

        // === STEP 6: Update DB Record ===
        console.log(
          `[TryBlock] 6. Updating DB row ${dbSegmentId} with Replicate ID ${replicatePredictionId}...`
        );
        const { error: updateError } = await supabase
          .from("transcription_segments")
          .update({
            replicate_prediction_id: replicatePredictionId,
            status: "processing",
            start_time: transcriptionStartTime, // Ensure times are updated too
            end_time: transcriptionEndTime,
            error_message: null, // Clear any previous error
          })
          .eq("id", dbSegmentId!); // Use the determined segment ID

        if (updateError) {
          console.error(
            `Failed to update transcription row ${dbSegmentId} with Replicate ID ${replicatePredictionId}:`,
            updateError.message
          );
          // Attempt to cancel Replicate job? Difficult. Log and maybe mark as failed later?
          throw new AppError(
            AppErrorCode.DATABASE_ERROR,
            `Failed to update transcription status after starting Replicate: ${updateError.message}`
          );
        }

        console.log(
          `[TryBlock] 6. DB row ${dbSegmentId} updated successfully.`
        );
        return { success: true, data: { success: true } };
      } catch (error: unknown) {
        console.error(
          `RequestFullTranscription: Error caught requesting full transcription for video ${videoId}:`,
          error
        );
        const appErr =
          error instanceof AppError
            ? error
            : new AppError(
                AppErrorCode.UNEXPECTED_ERROR,
                error instanceof Error
                  ? error.message
                  : "Unknown error in internalRequestFullTranscription"
              );
        console.error(
          `RequestFullTranscription: Preparing failure response with error object:`,
          JSON.stringify(appErr, null, 2)
        );
        // Add detailed log before returning
        console.log(
          `[DEBUG] Returning error from internalRequestFullTranscription: success=false, error=`,
          appErr
        );
        return { success: false, error: appErr };
      }
    }
  );

// --- Action: Internal Translate Full Segment Content --- // MODIFIED
const internalTranslateFullContentSchema = z.object({
  segmentId: z.string().uuid(),
  targetLanguage: z.string().length(2),
});

export const internalTranslateFullContent = publicAction
  .schema(internalTranslateFullContentSchema)
  .action(async ({ parsedInput }): Promise<ActionResponse<null>> => {
    const { segmentId, targetLanguage } = parsedInput;
    const supabase = supabaseServiceRoleClient;

    console.log(
      `INTERNAL ACTION: Enqueuing translation job for segment ${segmentId} to ${targetLanguage}`
    );

    try {
      // 1. Basic Pre-check: Check if translation *might* already exist to avoid unnecessary jobs
      // This is a quick check, the Inngest job will do the definitive check.
      const { data: segmentData, error: fetchError } = await supabase
        .from("transcription_segments")
        .select("translations") // Only need translations for pre-check
        .eq("id", segmentId)
        .maybeSingle(); // Use maybeSingle as it might not exist yet

      if (fetchError) {
        console.warn(
          `TranslateEnqueue: DB error pre-checking transcription ${segmentId}: ${fetchError.message}`
        );
        // Proceed with enqueuing even if check fails
      } else if (segmentData) {
        const existingTranslations = (segmentData.translations ?? {}) as Record<
          string,
          any
        >;
        if (existingTranslations[targetLanguage]?.segments?.length > 0) {
          console.log(
            `TranslateEnqueue: Pre-check indicates translation for ${targetLanguage} likely exists for ${segmentId}. Skipping enqueue.`
          );
          return { success: true, data: null }; // Skip enqueue
        }
      }

      // 2. Enqueue the Inngest job
      await inngest.send({
        name: "translation/request", // Matches event name in Inngest function
        data: {
          segmentId: segmentId,
          targetLanguage: targetLanguage,
        },
      });

      console.log(
        `INTERNAL ACTION: Successfully enqueued translation job for ${segmentId} to ${targetLanguage}.`
      );
      return { success: true, data: null };
    } catch (error: unknown) {
      console.error(
        `INTERNAL ACTION: Error enqueuing translation job for row ${segmentId} to ${targetLanguage}:`,
        error
      );
      const appErr =
        error instanceof AppError
          ? error
          : new AppError(
              AppErrorCode.UNEXPECTED_ERROR,
              error instanceof Error
                ? error.message
                : "Unknown error enqueuing translation job"
            );
      return { success: false, error: appErr };
    }
  });

// --- Action: Internal Generate Audio Chunk --- // MODIFIED
const internalGenerateAudioChunkSchema = z
  .object({
    videoId: z.string().uuid(),
    language: z.string(),
    voice: z.string(),
    startTime: z.number().min(0),
    endTime: z.number().min(0),
  })
  .refine((data) => data.endTime > data.startTime, {
    message: "End time must be greater than start time",
    path: ["endTime"],
  });

export const internalGenerateAudioChunk = publicAction
  .schema(internalGenerateAudioChunkSchema)
  .action(
    async ({ parsedInput }): Promise<ActionResponse<{ success: boolean }>> => {
      const { videoId, language, voice, startTime, endTime } = parsedInput;
      const supabase = supabaseServiceRoleClient;

      console.log(
        `INTERNAL ACTION: Enqueuing TTS chunk job for ${videoId}, ${language}, ${voice}, ${startTime}-${endTime}`
      );

      try {
        // 1. Pre-check if chunk already exists in DB
        const { data: existingChunk, error: checkError } = await supabase
          .from("translated_audio_chunks")
          .select("id") // Select minimal field
          .eq("video_id", videoId)
          .eq("language", language)
          .eq("voice", voice)
          .eq("chunk_start", startTime)
          .eq("chunk_end", endTime)
          .limit(1)
          .maybeSingle();

        if (checkError) {
          console.warn(
            `TTSChunkEnqueue: DB error pre-checking chunk ${videoId}/${language}/${voice}/${startTime}-${endTime}: ${checkError.message}`
          );
          // Proceed with enqueue even if check fails
        } else if (existingChunk) {
          console.log(
            `TTSChunkEnqueue: Pre-check indicates chunk ${videoId}/${language}/${voice}/${startTime}-${endTime} likely exists. Skipping enqueue.`
          );
          return { success: true, data: { success: true } }; // Skip enqueue
        }

        // 2. Extract text (this needs to happen here, as we need the text for the job payload)
        //    This logic is copied from the original function
        console.log(
          `TTSChunkEnqueue: Fetching transcription to extract text...`
        );
        const { data: transcriptionDataUntyped, error: transcriptionError } =
          await supabase
            .from("transcription_segments")
            .select("id, content, translations")
            .eq("video_id", videoId)
            .eq("status", "completed")
            .single();

        if (transcriptionError)
          throw new AppError(
            AppErrorCode.DATABASE_ERROR,
            `DB error fetching transcription for chunk enqueue: ${transcriptionError.message}`
          );

        const transcriptionData = transcriptionDataUntyped as any;
        let textToSynthesize = "";
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
              `Original transcription content missing.`
            );
        } else {
          const translatedContent = transcriptionData.translations?.[
            language
          ] as ReplicateSegmentOutput | null;
          sourceSegments = translatedContent?.segments;
          if (!sourceSegments)
            throw new AppError(
              AppErrorCode.DEPENDENCY_NOT_READY,
              `Translation '${language}' not found.`
            );
        }

        const targetSegment = sourceSegments.find(
          (s) =>
            s.start !== undefined &&
            Math.abs(s.start - startTime) < 0.01 &&
            s.end !== undefined &&
            Math.abs(s.end - endTime) < 0.01
        );

        if (targetSegment?.text) {
          textToSynthesize = targetSegment.text.trim();
        } else {
          console.warn(
            `TTSChunkEnqueue: Could not find exact sub-segment text for ${language}, ${startTime}-${endTime}. Using fallback range extraction.`
          );
          const reconstructOutput: ReplicateSegmentOutput = {
            segments: sourceSegments,
          };
          textToSynthesize = extractTextFromSegments(
            [reconstructOutput],
            startTime,
            endTime
          );
        }

        if (!textToSynthesize.trim()) {
          console.warn(
            `TTSChunkEnqueue: No text found for ${videoId} (${startTime}-${endTime}). Skipping job enqueue.`
          );
          return { success: true, data: { success: true } }; // Nothing to generate
        }

        // 3. Enqueue the Inngest job
        await inngest.send({
          name: "tts/generate-chunk",
          data: {
            videoId: videoId,
            language: language,
            voice: voice,
            startTime: startTime,
            endTime: endTime,
            textToSynthesize: textToSynthesize, // Pass the extracted text
          },
        });

        console.log(
          `INTERNAL ACTION: Successfully enqueued TTS chunk job for ${startTime}-${endTime}.`
        );
        return { success: true, data: { success: true } };
      } catch (error: unknown) {
        console.error(
          `INTERNAL ACTION: Error enqueuing TTS chunk job ${startTime}-${endTime}:`,
          error
        );
        const appErr =
          error instanceof AppError
            ? error
            : new AppError(
                AppErrorCode.UNEXPECTED_ERROR,
                error instanceof Error
                  ? error.message
                  : "Unknown error enqueuing TTS chunk job"
              );
        return { success: false, error: appErr };
      }
    }
  );

// --- Action: Internal Spawn TTS Jobs --- // MODIFIED
const internalSpawnTtsJobsSchema = z.object({
  videoId: z.string().uuid(),
  language: z.string(),
  voice: z.string(),
});

export const internalSpawnTtsJobs = publicAction
  .schema(internalSpawnTtsJobsSchema)
  .action(
    async ({ parsedInput }): Promise<ActionResponse<{ success: boolean }>> => {
      const { videoId, language, voice } = parsedInput;

      console.log(
        `INTERNAL ACTION: Enqueuing initial TTS spawn job for ${videoId}, ${language}, ${voice}`
      );

      try {
        // Minimal pre-checks can be done here if needed, but the main logic is in the job

        await inngest.send({
          name: "tts/spawn-initial",
          data: {
            videoId: videoId,
            language: language,
            voice: voice,
          },
        });

        console.log(
          `INTERNAL ACTION: Successfully enqueued initial TTS spawn job.`
        );
        return { success: true, data: { success: true } };
      } catch (error: unknown) {
        console.error(
          `INTERNAL ACTION: Error enqueuing initial TTS spawn job for ${videoId}, ${language}, ${voice}:`,
          error
        );
        const appErr =
          error instanceof AppError
            ? error
            : new AppError(
                AppErrorCode.UNEXPECTED_ERROR,
                error instanceof Error
                  ? error.message
                  : "Unknown error enqueuing TTS spawn job"
              );
        // Consider updating status to failed here?
        // For now, just return error. The job handler will manage status on its failure.
        return { success: false, error: appErr };
      }
    }
  );
