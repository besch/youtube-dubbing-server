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

// --- Action: Internal Translate Full Segment Content --- // Renamed Action
const internalTranslateFullContentSchema = z.object({
  segmentId: z.string().uuid(), // ID of the single transcription_segments row
  targetLanguage: z.string().length(2), // ISO 639-1 code
});

export const internalTranslateFullContent = publicAction // Renamed export
  .schema(internalTranslateFullContentSchema)
  .action(async ({ parsedInput }): Promise<ActionResponse<null>> => {
    const { segmentId, targetLanguage } = parsedInput;
    const supabase = supabaseServiceRoleClient;

    console.log(
      `INTERNAL ACTION: Translating FULL content for segment row ${segmentId} to language: ${targetLanguage}`
    );

    try {
      // 1. Fetch the transcription data (single row)
      console.log(
        `TranslateFullContent: Fetching transcription row ${segmentId}`
      );
      const { data: segmentDataUntyped, error: fetchError } = await supabase
        .from("transcription_segments")
        .select("id, content, translations") // Fetch content and existing translations
        .eq("id", segmentId)
        .single(); // Expect exactly one row

      if (fetchError)
        throw new AppError(
          AppErrorCode.DATABASE_ERROR,
          `DB error fetching transcription row ${segmentId}: ${fetchError.message}`
        );
      // No need to check for null, single() throws if not found

      const segmentData = segmentDataUntyped as any; // Use 'as any' for simplicity
      console.log(
        `TranslateFullContent: Fetched segmentData for row ${segmentId}. Keys: ${Object.keys(
          segmentData
        )}`
      );
      // Add detailed log for content and translations
      console.log(
        `TranslateFullContent: segmentData.content keys (if object): ${
          segmentData.content
            ? Object.keys(segmentData.content)
            : "null/undefined"
        }`
      );
      console.log(
        `TranslateFullContent: segmentData.translations keys (if object): ${
          segmentData.translations
            ? Object.keys(segmentData.translations)
            : "null/undefined"
        }`
      );

      const existingTranslations = (segmentData.translations ?? {}) as Record<
        string,
        ReplicateSegmentOutput
      >;

      // Log check for existing translation
      const translationAlreadyExists =
        existingTranslations[targetLanguage] &&
        Array.isArray(existingTranslations[targetLanguage]?.segments) &&
        existingTranslations[targetLanguage].segments.length > 0;

      console.log(
        `TranslateFullContent: Checking existing translation for ${targetLanguage}: ${translationAlreadyExists}`
      );

      // Check if translation already exists and is valid
      if (translationAlreadyExists) {
        console.log(
          `>>> TranslateFullContent: Translation for ${targetLanguage} already exists and seems valid for row ${segmentId}. Skipping.`
        );
        return { success: true, data: null };
      }

      console.log(
        `>>> TranslateFullContent: Translation for ${targetLanguage} not found or invalid for row ${segmentId}. Proceeding.`
      );

      // 2. Validate content structure
      let originalContent: ReplicateSegmentOutput | null = null;
      if (
        segmentData.content &&
        typeof segmentData.content === "object" &&
        !Array.isArray(segmentData.content) &&
        "segments" in segmentData.content &&
        Array.isArray(segmentData.content.segments)
      ) {
        originalContent = segmentData.content as ReplicateSegmentOutput;
        console.log(
          `TranslateFullContent: Valid original content found with ${originalContent.segments?.length} segments.`
        );
      } else {
        console.error(
          `TranslateFullContent: Invalid 'content' structure in row ${segmentId}. Content:`,
          segmentData.content
        );
        throw new AppError(
          AppErrorCode.INVALID_INPUT,
          `Transcription row ${segmentId} has invalid 'content' structure for translation.`
        );
      }

      if (!originalContent?.segments || originalContent.segments.length === 0) {
        console.log(
          `Transcription row ${segmentId} content is empty, skipping translation.`
        );
        // Update translations field with empty object for this language? Or just succeed?
        // Let's just succeed for now.
        return { success: true, data: null }; // Nothing to translate
      }

      // 3. Prepare for Translation
      const sourceLangCode = originalContent.detected_language || "en";
      const sourceLangName =
        config.languages.find((l) => l.code === sourceLangCode)?.name ||
        sourceLangCode;
      const targetLangName =
        config.languages.find((l) => l.code === targetLanguage)?.name ||
        targetLanguage;

      console.log(
        `TranslateFullContent: Source lang: ${sourceLangCode} (${sourceLangName}), Target lang: ${targetLanguage} (${targetLangName})`
      );

      if (sourceLangCode === targetLanguage) {
        console.log(
          `Source and target language (${targetLanguage}) are the same for row ${segmentId}. Skipping translation call.`
        );
        // Store original as 'translation' if needed? For consistency, let's do it.
        const updatedTranslations = {
          ...existingTranslations,
          [targetLanguage]: originalContent, // Store original content under the target language key
        };
        console.log(
          `TranslateFullContent: Storing original content as translation for ${targetLanguage}. Updating DB...`
        );
        const { error: updateError } = await supabase
          .from("transcription_segments")
          .update({ translations: updatedTranslations } as any)
          .eq("id", segmentId);
        if (updateError) {
          console.error(
            `TranslateFullContent: DB Error storing original content as translation for ${segmentId}:`,
            updateError
          );
          // Don't fail the whole action, just log it?
        }
        return { success: true, data: null };
      }

      // Format the *entire* transcription for translation
      console.log("TranslateFullContent: Formatting text for translation...");
      const textToTranslate = formatTranscriptionForTranslation(
        originalContent.segments
      );
      if (!textToTranslate) {
        console.log(
          `No text found to translate in transcription row ${segmentId}.`
        );
        return { success: true, data: null };
      }

      console.log(
        `TranslateFullContent: Calling Translation Service (Gemini) to translate content from row ${segmentId} to ${targetLangName}`
      );
      console.log(
        `TranslateFullContent: Text to translate (first 100 chars): "${textToTranslate.substring(
          0,
          100
        )}..."`
      );

      // 4. Call Translation Service
      const translatedText = await translateText(
        textToTranslate,
        targetLangName
      );
      console.log(
        `TranslateFullContent: Received response from translateText. Is empty: ${!translatedText}`
      );

      if (!translatedText) {
        throw new AppError(
          AppErrorCode.SERVICE_ERROR,
          "Translation service returned empty response."
        );
      }
      console.log(
        `TranslateFullContent: Received translation (first 100 chars): "${translatedText.substring(
          0,
          100
        )}..."`
      );

      // 5. Parse Translation Response
      console.log("TranslateFullContent: Parsing translation response...");
      const parsedSegments = parseTranslationResponse(
        translatedText,
        originalContent.segments // Pass original segments for timing alignment
      );
      console.log(
        `TranslateFullContent: Parsed translation into ${
          parsedSegments?.length ?? 0
        } segments.`
      );

      if (!parsedSegments || parsedSegments.length === 0) {
        throw new AppError(
          AppErrorCode.SERVICE_ERROR,
          `Failed to parse translation response or got empty segments for row ${segmentId}.`
        );
      }

      const translatedContent: ReplicateSegmentOutput = {
        segments: parsedSegments,
        detected_language: targetLanguage, // Set detected language to the target
      };

      // 6. Update Database
      const updatedTranslations = {
        ...existingTranslations,
        [targetLanguage]: translatedContent,
      };

      console.log(
        `>>> TranslateFullContent: Preparing to update DB for row ${segmentId} with FULL translation for language ${targetLanguage}. Keys in updatedTranslations: ${Object.keys(
          updatedTranslations
        )}`
      );
      const { error: updateError } = await supabase
        .from("transcription_segments")
        .update({ translations: updatedTranslations } as any) // Cast needed for JSONB update
        .eq("id", segmentId);

      if (updateError) {
        console.error(
          `>>> TranslateFullContent: DB Update Error for row ${segmentId}:`,
          updateError
        );
        throw new AppError(
          AppErrorCode.DATABASE_ERROR,
          `DB error updating translations for row ${segmentId}: ${updateError.message}`
        );
      }

      console.log(
        `>>> TranslateFullContent: DB Update successful for row ${segmentId}.`
      );
      console.log(
        `INTERNAL ACTION: Successfully translated and stored FULL ${targetLanguage} content for row ${segmentId}.`
      );
      return { success: true, data: null };
    } catch (error: unknown) {
      console.error(
        `INTERNAL ACTION: Error translating full content for row ${segmentId} to ${targetLanguage}:`,
        error
      );
      // Log the detailed error object
      console.error("Caught Error Details:", JSON.stringify(error, null, 2));

      const appErr =
        error instanceof AppError
          ? error
          : new AppError(
              AppErrorCode.UNEXPECTED_ERROR,
              error instanceof Error
                ? error.message
                : "Unknown error in internalTranslateFullContent" // Updated name
            );
      return { success: false, error: appErr };
    }
  });

// --- Action: Internal Generate Audio Chunk ---
const internalGenerateAudioChunkSchema = z
  .object({
    videoId: z.string().uuid(),
    language: z.string(),
    voice: z.string(),
    startTime: z.number().min(0), // Start time of the specific sub-segment
    endTime: z.number().min(0), // End time of the specific sub-segment
  })
  .refine((data) => data.endTime > data.startTime, {
    message: "End time must be greater than start time",
    path: ["endTime"],
  });

export const internalGenerateAudioChunk = publicAction
  .schema(internalGenerateAudioChunkSchema)
  .action(
    async ({
      parsedInput,
    }): Promise<ActionResponse<{ storagePath: string }>> => {
      const { videoId, language, voice, startTime, endTime } = parsedInput;
      const supabase = supabaseServiceRoleClient;

      console.log(
        `[internalGenerateAudioChunk] START - Video: ${videoId}, Lang: ${language}, Voice: ${voice}, Time: ${startTime}-${endTime}`
      );

      let ttsProvider: "openai" | "google";
      let googleLangCode: string | undefined;
      let googleVoiceName: string | undefined;
      let openaiVoiceName: string | undefined;

      // --- TTS Provider Selection Logic (Unchanged) ---
      if (config.openai.voices.includes(voice)) {
        ttsProvider = "openai";
        openaiVoiceName = voice;
        console.log(`Using OpenAI TTS based on voice: ${openaiVoiceName}`);
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
            return {
              success: false,
              error: new AppError(
                AppErrorCode.INVALID_INPUT,
                `Invalid Google voice '${voice}' for lang '${language}'. Valid Google voices: ${validGoogleVoices
                  .map((v) => v.id)
                  .join(", ")}`
              ),
            };
          }
          googleVoiceName = voice;
          console.log(
            `Using Google TTS for language: ${language} (${googleLangCode}), voice: ${googleVoiceName}`
          );
        } else {
          return {
            success: false,
            error: new AppError(
              AppErrorCode.INVALID_INPUT,
              `Voice '${voice}' is not a valid OpenAI voice, and language '${language}' is not supported by Google TTS or the voice is invalid for it.`
            ),
          };
        }
      }
      // --- End TTS Provider Selection ---

      console.log(
        `INTERNAL ACTION: Generating audio chunk for SUB-SEGMENT: ${videoId}, Lang: ${language}, Voice: ${voice}, Time: ${startTime}-${endTime} using ${ttsProvider}`
      );

      try {
        // 2. Check if exact chunk already exists (Unchanged)
        console.log(
          `[internalGenerateAudioChunk] Checking for existing chunk...`
        );
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
          console.log(
            `[internalGenerateAudioChunk] Chunk already exists at ${existingPath}. Skipping generation.`
          );
          return { success: true, data: { storagePath: existingPath } };
        }
        console.log(
          `[internalGenerateAudioChunk] Chunk does not exist. Proceeding.`
        );

        // 3. Fetch the SINGLE transcription row for the video
        console.log(
          `[internalGenerateAudioChunk] Fetching transcription row for video ${videoId}`
        );
        const { data: transcriptionDataUntyped, error: transcriptionError } =
          await supabase
            .from("transcription_segments")
            .select("id, content, translations") // Select needed fields
            .eq("video_id", videoId)
            .eq("status", "completed") // Ensure transcription is complete
            .single(); // Expect exactly one row

        if (transcriptionError)
          throw new AppError(
            AppErrorCode.DATABASE_ERROR,
            `DB error fetching transcription for chunk gen: ${transcriptionError.message}`
          );
        // No need to check for null, single() throws if not found

        const transcriptionData = transcriptionDataUntyped as any; // Use 'as any' for simplicity

        // 4. Extract Text for the Specific SUB-SEGMENT Time Range & Language
        let textToSynthesize = "";
        let sourceSegments:
          | ReplicateSegmentOutput["segments"]
          | undefined
          | null = null;
        console.log(
          `[internalGenerateAudioChunk] Extracting text for language: ${language}`
        );

        if (language === "en") {
          const originalContent =
            transcriptionData.content as ReplicateSegmentOutput | null;
          sourceSegments = originalContent?.segments;
          if (!sourceSegments) {
            throw new AppError(
              AppErrorCode.DEPENDENCY_NOT_READY,
              `Original transcription content missing or invalid for ${videoId} (EN).`
            );
          }
        } else {
          const translatedContent = transcriptionData.translations?.[
            language
          ] as ReplicateSegmentOutput | null;
          sourceSegments = translatedContent?.segments;
          if (!sourceSegments) {
            throw new AppError(
              AppErrorCode.DEPENDENCY_NOT_READY,
              `Translation '${language}' not found or invalid for ${videoId}.`
            );
          }
        }

        // Find the specific sub-segment text matching startTime and endTime
        console.log(
          `[internalGenerateAudioChunk] Searching for target segment ${startTime}-${endTime}...`
        );
        const targetSegment = sourceSegments.find(
          (s) =>
            s.start !== undefined &&
            Math.abs(s.start - startTime) < 0.01 && // Allow minor float differences
            s.end !== undefined &&
            Math.abs(s.end - endTime) < 0.01
        );

        if (targetSegment?.text) {
          textToSynthesize = targetSegment.text.trim();
        } else {
          console.warn(
            `[internalGenerateAudioChunk] Could not find exact sub-segment text for ${language}, ${startTime}-${endTime}. Using fallback range extraction.`
          );
          // Fallback: Use the range extraction (might concatenate parts of adjacent segments)
          // This helper needs the full ReplicateSegmentOutput structure, not just the segments array.
          // Reconstruct the minimum needed structure for the helper.
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
            `[internalGenerateAudioChunk] No text found for TTS in ${language} for ${videoId} (${startTime}-${endTime}). Skipping chunk generation.`
          );
          // Indicate skipped generation with an empty path
          return {
            success: true,
            data: { storagePath: "" }, // Caller must check for empty path
          };
        }
        console.log(
          `[internalGenerateAudioChunk] Text extracted (first 100): "${textToSynthesize.substring(
            0,
            100
          )}..."`
        );

        // 5. Call appropriate TTS function (Unchanged)
        let ttsResult: { audioBuffer: Buffer; storagePath: string };
        console.log(
          `[internalGenerateAudioChunk] Calling ${ttsProvider} TTS...`
        );
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
        console.log(
          `[internalGenerateAudioChunk] TTS call completed. Storage path: ${ttsResult.storagePath}`
        );

        const { audioBuffer, storagePath: chunkStoragePath } = ttsResult;

        // 6. Upload TTS chunk (Unchanged)
        console.log(
          `[internalGenerateAudioChunk] Uploading TTS chunk to: ${chunkStoragePath}`
        );
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
        console.log(
          `[internalGenerateAudioChunk] TTS chunk uploaded successfully.`
        );

        // 7. Insert record into translated_audio_chunks (Unchanged)
        console.log(
          `[internalGenerateAudioChunk] Inserting chunk record into DB...`
        );
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
            "[internalGenerateAudioChunk] DB Error inserting translated chunk record:",
            dbInsertError.message
          );
          // Don't throw, log and continue? Or should upload be reverted?
        } else if (dbInsertError?.code === "23505") {
          console.warn(
            `[internalGenerateAudioChunk] Race condition: translated_audio_chunk for ${chunkStoragePath} inserted concurrently.`
          );
        }
        console.log(
          `[internalGenerateAudioChunk] DB insert completed (or handled race condition).`
        );

        // 8. Return the storage path (Unchanged)
        console.log(
          `[internalGenerateAudioChunk] Returning chunk storage path: ${chunkStoragePath}`
        );
        return { success: true, data: { storagePath: chunkStoragePath } };
      } catch (error: unknown) {
        console.error(
          `[internalGenerateAudioChunk] ERROR generating audio chunk ${startTime}-${endTime}:`,
          error
        );
        // Log the detailed error object
        console.error(
          "[internalGenerateAudioChunk] Caught Error Details:",
          JSON.stringify(error, null, 2)
        );

        const appErr =
          error instanceof AppError
            ? error
            : new AppError(
                AppErrorCode.UNEXPECTED_ERROR,
                error instanceof Error
                  ? error.message
                  : "Unknown error in internalGenerateAudioChunk"
              );
        // Consider how failures here should update processing_status
        // For now, return error to the calling Supabase function
        return { success: false, error: appErr };
      }
    }
  );

// --- Action: Internal Spawn TTS Jobs ---
const internalSpawnTtsJobsSchema = z.object({
  videoId: z.string().uuid(),
  language: z.string(),
  voice: z.string(),
});

export const internalSpawnTtsJobs = publicAction
  .schema(internalSpawnTtsJobsSchema)
  .action(
    async ({
      parsedInput,
    }): Promise<ActionResponse<{ jobsTriggered: number }>> => {
      const { videoId, language, voice } = parsedInput;
      const supabase = supabaseServiceRoleClient;

      console.log(
        `INTERNAL ACTION: Spawning TTS jobs for Video: ${videoId}, Lang: ${language}, Voice: ${voice}`
      );

      try {
        // 1. Fetch the completed transcription row
        const { data: transcriptionDataUntyped, error: transcriptionError } =
          await supabase
            .from("transcription_segments")
            .select("id, content, translations")
            .eq("video_id", videoId)
            .eq("status", "completed") // Ensure it's actually done
            .single();

        if (transcriptionError) {
          throw new AppError(
            AppErrorCode.DATABASE_ERROR,
            `DB error fetching transcription for TTS spawning: ${transcriptionError.message}`
          );
        }
        const transcriptionData = transcriptionDataUntyped as any; // Use 'as any' for simplicity

        // 2. Extract relevant segments
        let sourceSegments:
          | ReplicateSegmentOutput["segments"]
          | undefined
          | null = null;

        if (language === "en") {
          const originalContent =
            transcriptionData.content as ReplicateSegmentOutput | null;
          sourceSegments = originalContent?.segments;
          if (!sourceSegments) {
            throw new AppError(
              AppErrorCode.DEPENDENCY_NOT_READY,
              `Original transcription content missing or invalid for ${videoId} (EN) when spawning TTS.`
            );
          }
        } else {
          const translatedContent = transcriptionData.translations?.[
            language
          ] as ReplicateSegmentOutput | null;
          sourceSegments = translatedContent?.segments;
          if (!sourceSegments) {
            throw new AppError(
              AppErrorCode.DEPENDENCY_NOT_READY,
              `Translation '${language}' not found or invalid for ${videoId} when spawning TTS.`
            );
          }
        }

        if (!sourceSegments || sourceSegments.length === 0) {
          console.log(
            `INTERNAL ACTION: No segments found for ${language} in video ${videoId}. No TTS jobs to trigger.`
          );
          return { success: true, data: { jobsTriggered: 0 } };
        }

        // 3. Loop and trigger internalGenerateAudioChunk for each segment via API
        let jobsTriggered = 0;
        let triggerErrors = 0;
        for (const subSegment of sourceSegments) {
          if (
            subSegment.start !== undefined &&
            subSegment.end !== undefined &&
            subSegment.text?.trim() &&
            subSegment.end > subSegment.start &&
            subSegment.end <= 60
          ) {
            const payload = {
              videoId: videoId,
              language: language,
              voice: voice,
              startTime: subSegment.start,
              endTime: subSegment.end,
            };
            // Call the helper function - DO NOT AWAIT
            triggerInternalAction("internalGenerateAudioChunk", payload).then(
              (result) => {
                if (!result.success) {
                  // Log errors from the async trigger call
                  console.error(
                    `INTERNAL ACTION: Failed to trigger TTS for ${language}/${voice}, segment ${subSegment.start}-${subSegment.end}:`,
                    result.error
                  );
                  // Increment error count - maybe update status later?
                  triggerErrors++;
                }
              }
            );
            jobsTriggered++;
          } else {
            console.warn(
              `INTERNAL ACTION: Skipping invalid segment for TTS spawning:`,
              subSegment
            );
          }
        }

        console.log(
          `INTERNAL ACTION: Finished spawning ${jobsTriggered} TTS jobs for ${videoId}, ${language}, ${voice}. Trigger errors: ${triggerErrors}.`
        );
        // Return success even if some triggers failed; progress relies on chunks being inserted
        return { success: true, data: { jobsTriggered } };
      } catch (error: unknown) {
        console.error(
          `INTERNAL ACTION: Error spawning TTS jobs for ${videoId}, ${language}, ${voice}:`,
          error
        );
        const appErr =
          error instanceof AppError
            ? error
            : new AppError(
                AppErrorCode.UNEXPECTED_ERROR,
                error instanceof Error
                  ? error.message
                  : "Unknown error in internalSpawnTtsJobs"
              );
        return { success: false, error: appErr };
      }
    }
  );
