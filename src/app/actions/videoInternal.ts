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

// --- Helper: Call Audio Segmenter Microservice (Copied from video.ts) ---
// Constants
const AUDIO_SEGMENTER_URL = process.env.AUDIO_SEGMENTER_URL;
const AUDIO_SEGMENTER_SECRET_KEY = process.env.AUDIO_SEGMENTER_SECRET_KEY;

// Check if the environment variables are set
if (!AUDIO_SEGMENTER_URL) {
  console.error("AUDIO_SEGMENTER_URL environment variable is not set.");
}
if (!AUDIO_SEGMENTER_SECRET_KEY) {
  console.error("AUDIO_SEGMENTER_SECRET_KEY environment variable is not set.");
}

async function getAudioSegmentPath(
  videoId: string,
  startTime: number,
  endTime: number
): Promise<string> {
  if (!AUDIO_SEGMENTER_URL || !AUDIO_SEGMENTER_SECRET_KEY) {
    console.error("Audio Segmenter URL or Secret Key not configured!");
    throw new AppError(
      AppErrorCode.CONFIGURATION_ERROR,
      "Audio Segmenter not configured"
    );
  }

  // Workaround for segmenter validation: send a tiny positive value if startTime is 0
  const segmenterStartTime = startTime === 0 ? 0.01 : startTime;

  console.log(
    `InternalAction: Calling Audio Segmenter at ${AUDIO_SEGMENTER_URL} for video ${videoId} (Sent Time: ${segmenterStartTime}-${endTime}, Original Start: ${startTime})`
  );
  try {
    const response = await fetch(`${AUDIO_SEGMENTER_URL}/segment-transcribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": AUDIO_SEGMENTER_SECRET_KEY,
      },
      body: JSON.stringify({
        video_id: videoId,
        start_time: segmenterStartTime, // Use the adjusted start time here
        end_time: endTime,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(
        `InternalAction: Audio Segmenter Error (${response.status}): ${errorBody}`
      );
      let detailMessage = `Status ${response.status}: ${errorBody}`;
      try {
        const parsedError = JSON.parse(errorBody);
        if (typeof parsedError.detail === "string") {
          detailMessage = parsedError.detail;
        } else {
          detailMessage = JSON.stringify(parsedError);
        }
      } catch {
        // Parsing failed
      }
      throw new AppError(
        AppErrorCode.AUDIO_SEGMENTER_ERROR,
        `Audio Segmenter failed: ${detailMessage}`
      );
    }

    const data = await response.json();
    if (!data.segment_storage_path) {
      console.error(
        "InternalAction: Audio Segmenter response missing segment_storage_path:",
        data
      );
      throw new AppError(
        AppErrorCode.SERVICE_ERROR,
        "Audio Segmenter did not return segment path"
      );
    }
    console.log(
      `InternalAction: Audio Segmenter returned path: ${data.segment_storage_path}`
    );
    return data.segment_storage_path;
  } catch (error: unknown) {
    console.error("InternalAction: Error calling Audio Segmenter:", error);
    if (error instanceof AppError) throw error;
    const message =
      error instanceof Error ? error.message : "Unknown communication error";
    throw new AppError(
      AppErrorCode.SERVICE_ERROR,
      `Failed to communicate with Audio Segmenter: ${message}`
    );
  }
}

// --- Helper Function: Extract Text from Segments for Time Range (Copied from video.ts) ---
// Needs ReplicateSegmentOutput type from imports below
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
// --- End Helper Function ---

// --- Action: Internal Request Transcription Segment ---
const internalRequestTranscriptionSegmentSchema = z
  .object({
    videoId: z.string().uuid(),
    startTime: z.number().min(0),
    endTime: z
      .number()
      .min(0)
      .refine((val) => val > 0, { message: "End time must be greater than 0" }),
  })
  .refine((data) => data.endTime > data.startTime, {
    message: "End time must be greater than start time",
    path: ["endTime"],
  });

// Use publicAction - no user context needed
export const internalRequestTranscriptionSegment = publicAction
  .schema(internalRequestTranscriptionSegmentSchema)
  .action(
    async ({ parsedInput }): Promise<ActionResponse<{ success: boolean }>> => {
      // No ctx needed
      const { videoId, startTime, endTime } = parsedInput;
      const supabase = supabaseServiceRoleClient; // Use service role client directly

      console.log(
        `INTERNAL ACTION: Requesting transcription segment for video ${videoId} from ${startTime} to ${endTime}`
      );

      try {
        console.log(
          `InternalRequestSegment: Checking for existing segment: Video=${videoId}, Start=${startTime}, End=${endTime}`
        );
        // 1. Check if segment already exists/processing
        const { data: existingSegment, error: checkError } = await supabase
          .from("transcription_segments")
          .select("id, status")
          .eq("video_id", videoId)
          .eq("start_time", startTime)
          .eq("end_time", endTime)
          .maybeSingle();

        if (checkError) {
          throw new AppError(
            AppErrorCode.DATABASE_ERROR,
            `DB error checking segment: ${checkError.message}`
          );
        }

        let dbSegmentId: string | undefined; // Use undefined initially
        let shouldProceed = true;

        if (existingSegment) {
          if (
            existingSegment.status === "completed" ||
            existingSegment.status === "processing"
          ) {
            console.log(
              `InternalRequestSegment: Found existing segment for ${videoId} (${startTime}-${endTime}). Status: ${existingSegment.status}. Skipping.`
            );
            shouldProceed = false;
          } else {
            console.log(
              `InternalRequestSegment: Found existing segment for ${videoId} (${startTime}-${endTime}) with status '${existingSegment.status}'. Proceeding to update and start Replicate job.`
            );
            dbSegmentId = existingSegment.id;
          }
        }

        if (!shouldProceed) {
          return { success: true, data: { success: true } };
        }

        // 2. Get audio segment path from microservice
        console.log(
          `InternalRequestSegment: Calling getAudioSegmentPath for video ${videoId} (${startTime}-${endTime})`
        );
        const segmentStoragePath = await getAudioSegmentPath(
          videoId,
          startTime,
          endTime
        );
        console.log(
          `InternalRequestSegment: Received segmentStoragePath: ${segmentStoragePath}`
        );

        // 3. Get signed URL for the segment
        console.log(
          `InternalRequestSegment: Getting signed URL for path: ${segmentStoragePath}`
        );
        const { data: urlData, error: urlError } = await supabase.storage
          .from("transcription-segments")
          .createSignedUrl(segmentStoragePath, 60 * 5);

        if (urlError)
          throw new AppError(
            AppErrorCode.SUPABASE_STORAGE_ERROR,
            `Failed to get signed URL: ${urlError.message}`
          );
        if (!urlData?.signedUrl)
          throw new AppError(
            AppErrorCode.SUPABASE_STORAGE_ERROR,
            "Signed URL creation returned no URL."
          );
        const segmentSignedUrl = urlData.signedUrl;
        console.log(
          `InternalRequestSegment: Got signed URL: ${segmentSignedUrl.substring(
            0,
            100
          )}...`
        );

        // 4. Insert or identify existing segment ID
        console.log(
          `InternalRequestSegment: Ensuring DB record exists for segment ${videoId} (${startTime}-${endTime})`
        );

        if (!dbSegmentId) {
          const { data: dbSegment, error: insertError } = await supabase
            .from("transcription_segments")
            .insert({
              video_id: videoId,
              start_time: startTime,
              end_time: endTime,
              status: "pending",
              segment_storage_path: segmentStoragePath,
            })
            .select("id")
            .single();

          if (insertError && insertError.code === "23505") {
            console.warn(
              `Race condition inserting segment ${videoId} (${startTime}-${endTime}). Fetching existing ID.`
            );
            const { data: raceSegment, error: raceError } = await supabase
              .from("transcription_segments")
              .select("id")
              .eq("video_id", videoId)
              .eq("start_time", startTime)
              .eq("end_time", endTime)
              .single();
            if (raceError || !raceSegment) {
              throw new AppError(
                AppErrorCode.DATABASE_ERROR,
                `Failed to fetch segment after insert race condition: ${
                  raceError?.message || "Not Found"
                }`
              );
            }
            dbSegmentId = raceSegment.id;
          } else if (insertError) {
            throw new AppError(
              AppErrorCode.DATABASE_ERROR,
              `DB error inserting segment: ${insertError.message}`
            );
          } else if (!dbSegment) {
            throw new AppError(
              AppErrorCode.DATABASE_ERROR,
              "Failed to insert segment record or get ID."
            );
          } else {
            dbSegmentId = dbSegment.id;
          }
          console.log(
            `InternalRequestSegment: Inserted/Confirmed DB segment record with ID: ${dbSegmentId}`
          );
        } else {
          console.log(
            `InternalRequestSegment: Using existing DB segment record with ID: ${dbSegmentId}`
          );
        }

        // 5. Start Replicate Transcription
        console.log(
          `InternalRequestSegment: Attempting to start Replicate transcription for segment ${dbSegmentId} using URL starting with: ${segmentSignedUrl.substring(
            0,
            100
          )}...`
        );
        const replicatePredictionId = await startReplicateTranscription(
          segmentSignedUrl
        );
        console.log(
          `InternalRequestSegment: Successfully started Replicate. Received Prediction ID: ${replicatePredictionId} for DB segment ${dbSegmentId}`
        );

        // 6. Update DB record with Replicate ID (processing)
        console.log(
          `InternalRequestSegment: Updating DB segment ${dbSegmentId} with Replicate ID ${replicatePredictionId}, segment path, and status 'processing'`
        );
        const { error: updateError } = await supabase
          .from("transcription_segments")
          .update({
            replicate_prediction_id: replicatePredictionId,
            status: "processing",
            segment_storage_path: segmentStoragePath, // Update path in case it changed
          })
          .eq("id", dbSegmentId!); // Use the determined segment ID

        if (updateError) {
          console.error(
            `Failed to update segment ${dbSegmentId} with Replicate ID ${replicatePredictionId}:`,
            updateError.message
          );
          throw new AppError(
            AppErrorCode.DATABASE_ERROR,
            `Failed to update segment status after starting Replicate: ${updateError.message}`
          );
        }

        console.log(
          `InternalRequestSegment: Successfully updated/initiated segment ${dbSegmentId} for ${videoId} (${startTime}-${endTime}), Replicate ID: ${replicatePredictionId}`
        );
        return { success: true, data: { success: true } };
      } catch (error: unknown) {
        console.error(
          `InternalRequestSegment: Error caught in main try block:`,
          error
        );
        const appErr =
          error instanceof AppError
            ? error
            : new AppError(
                AppErrorCode.UNEXPECTED_ERROR,
                error instanceof Error
                  ? error.message
                  : "Unknown error in internalRequestTranscriptionSegment"
              );
        console.error(
          `InternalRequestSegment: Returning failure response with error:`,
          JSON.stringify(appErr, null, 2)
        );
        return { success: false, error: appErr };
      }
    }
  );

// --- Action: Internal Translate Segment Content ---
const internalTranslateSegmentContentSchema = z.object({
  segmentId: z.string().uuid(),
  targetLanguage: z.string().length(2), // ISO 639-1 code
});

export const internalTranslateSegmentContent = publicAction
  .schema(internalTranslateSegmentContentSchema)
  .action(async ({ parsedInput }): Promise<ActionResponse<null>> => {
    // No ctx needed
    const { segmentId, targetLanguage } = parsedInput;
    const supabase = supabaseServiceRoleClient;

    console.log(
      `INTERNAL ACTION: Translating segment ${segmentId} to language: ${targetLanguage}`
    );

    try {
      // 1. Fetch the segment data
      const { data: segmentDataUntyped, error: fetchError } = await supabase
        .from("transcription_segments")
        .select("id, content, translations") // Fetch content and existing translations
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

      const segmentData = segmentDataUntyped as any; // Use 'as any' for simplicity
      const existingTranslations = (segmentData.translations ?? {}) as Record<
        string,
        ReplicateSegmentOutput
      >;

      // Check if translation already exists
      if (existingTranslations[targetLanguage]) {
        console.log(
          `>>> internalTranslateSegmentContent: Translation for ${targetLanguage} already exists for segment ${segmentId}. Skipping.`
        );
        return { success: true, data: null };
      }

      console.log(
        `>>> internalTranslateSegmentContent: Translation for ${targetLanguage} not found for segment ${segmentId}. Proceeding.`
      );

      // 2. Validate content
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

      if (!originalContent?.segments || originalContent.segments.length === 0) {
        console.log(
          `Segment ${segmentId} content is empty, skipping translation.`
        );
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

      if (sourceLangCode === targetLanguage) {
        console.log(
          `Source and target language (${targetLanguage}) are the same for segment ${segmentId}. Skipping translation call.`
        );
        // Store original as 'translation' if needed, or just return success
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

      // 4. Call Translation Service
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

      // 5. Parse Translation Response
      const parsedSegments = parseTranslationResponse(
        translatedText,
        originalContent.segments
      );
      if (!parsedSegments) {
        throw new AppError(
          AppErrorCode.SERVICE_ERROR,
          `Failed to parse translation response for segment ${segmentId}.`
        );
      }

      const translatedContent: ReplicateSegmentOutput = {
        segments: parsedSegments,
        // Optional: detected_language: targetLanguage
      };

      // 6. Update Database
      const updatedTranslations = {
        ...existingTranslations,
        [targetLanguage]: translatedContent,
      };

      console.log(
        `>>> internalTranslateSegmentContent: Updating DB for segment ${segmentId} with translations for language ${targetLanguage}`
      );
      const { error: updateError } = await supabase
        .from("transcription_segments")
        .update({ translations: updatedTranslations } as any)
        .eq("id", segmentId);

      if (updateError) {
        console.error(
          `>>> internalTranslateSegmentContent: DB Update Error for segment ${segmentId}:`,
          updateError
        );
        throw new AppError(
          AppErrorCode.DATABASE_ERROR,
          `DB error updating translations for segment ${segmentId}: ${updateError.message}`
        );
      }

      console.log(
        `>>> internalTranslateSegmentContent: DB Update successful for segment ${segmentId}.`
      );
      console.log(
        `INTERNAL ACTION: Successfully translated and stored ${targetLanguage} for segment ${segmentId}.`
      );
      return { success: true, data: null };
    } catch (error: unknown) {
      console.error(
        `INTERNAL ACTION: Error translating segment ${segmentId} to ${targetLanguage}:`,
        error
      );
      const appErr =
        error instanceof AppError
          ? error
          : new AppError(
              AppErrorCode.UNEXPECTED_ERROR,
              error instanceof Error
                ? error.message
                : "Unknown error in internalTranslateSegmentContent"
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
    async ({
      parsedInput,
    }): Promise<ActionResponse<{ storagePath: string }>> => {
      // No ctx needed
      // Changed return type to storagePath as signedURL is short-lived and generated later
      const { videoId, language, voice, startTime, endTime } = parsedInput;
      const supabase = supabaseServiceRoleClient;

      let ttsProvider: "openai" | "google";
      let googleLangCode: string | undefined;
      let googleVoiceName: string | undefined;
      let openaiVoiceName: string | undefined;

      // --- Revised TTS Provider Selection Logic ---
      // 1. Check if it's a known OpenAI voice first
      if (config.openai.voices.includes(voice)) {
        ttsProvider = "openai";
        openaiVoiceName = voice;
        console.log(`Using OpenAI TTS based on voice: ${openaiVoiceName}`);
      } else {
        // 2. If not OpenAI, check if Google supports the language
        const targetGoogleLangCode = config.google.simpleToGoogleMap[language];
        if (
          targetGoogleLangCode &&
          config.google.languages[targetGoogleLangCode]
        ) {
          ttsProvider = "google";
          googleLangCode = targetGoogleLangCode;
          const validGoogleVoices =
            config.google.languages[googleLangCode].voices;

          // 3. Validate the voice against Google's voices for that language
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
          // 4. Neither OpenAI voice nor Google supported language/voice combo
          return {
            success: false,
            error: new AppError(
              AppErrorCode.INVALID_INPUT,
              `Voice '${voice}' is not a valid OpenAI voice, and language '${language}' is not supported by Google TTS or the voice is invalid for it.`
            ),
          };
        }
      }
      // --- End Revised Logic ---

      console.log(
        `INTERNAL ACTION: Generating audio chunk for: ${videoId}, Lang: ${language}, Voice: ${voice}, Time: ${startTime}-${endTime} using ${ttsProvider}`
      );

      try {
        // 2. Check if exact chunk already exists
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
            `INTERNAL ACTION: Audio chunk already exists at ${existingPath}. Skipping generation.`
          );
          // Return the existing storage path instead of generating a signed URL
          return { success: true, data: { storagePath: existingPath } };
        }

        // 3. Fetch relevant COMPLETED transcription segments
        const { data: segmentsDataUntyped, error: segmentsError } =
          await supabase
            .from("transcription_segments")
            .select("id, start_time, end_time, content, translations")
            .eq("video_id", videoId)
            .eq("status", "completed")
            .lte("start_time", endTime) // Segment starts before or at chunk end
            .gte("end_time", startTime) // Segment ends after or at chunk start
            .order("start_time", { ascending: true });

        if (segmentsError)
          throw new AppError(
            AppErrorCode.DATABASE_ERROR,
            `DB error fetching segments: ${segmentsError.message}`
          );

        const segmentsData = segmentsDataUntyped as any[] | null;

        if (!segmentsData || segmentsData.length === 0) {
          throw new AppError(
            AppErrorCode.DEPENDENCY_NOT_READY,
            `Completed transcription/translation not available for ${videoId}, time ${startTime}-${endTime}.`
          );
        }

        // 4. Extract Text for the Specific Time Range & Language
        let textToSynthesize = "";
        if (language === "en") {
          const originalContents = segmentsData
            .map((s) => s.content as ReplicateSegmentOutput | null)
            .filter((c) => c !== null);
          if (originalContents.length === 0) {
            throw new AppError(
              AppErrorCode.DEPENDENCY_NOT_READY,
              `Original transcription content missing for ${videoId}, time ${startTime}-${endTime} (EN).`
            );
          }
          textToSynthesize = extractTextFromSegments(
            originalContents,
            startTime,
            endTime
          );
        } else {
          const translatedContents = segmentsData
            .map(
              (s) => s.translations?.[language] as ReplicateSegmentOutput | null
            )
            .filter((t) => t !== null);
          if (translatedContents.length === 0) {
            throw new AppError(
              AppErrorCode.DEPENDENCY_NOT_READY,
              `Translation '${language}' not found for ${videoId}, time ${startTime}-${endTime}.`
            );
          }
          textToSynthesize = extractTextFromSegments(
            translatedContents,
            startTime,
            endTime
          );
        }

        if (!textToSynthesize.trim()) {
          // Create a silent/empty chunk instead of throwing an error?
          // For now, treat as error to investigate why text is missing.
          console.warn(
            `INTERNAL ACTION: No text found for TTS in ${language} for ${videoId} (${startTime}-${endTime}). Segments fetched: ${segmentsData.length}`
          );
          throw new AppError(
            AppErrorCode.INVALID_INPUT, // Or a more specific code? RECORD_NOT_FOUND?
            `No text found for the time range ${startTime}-${endTime} in ${language}.`
          );
        }

        console.log(
          `INTERNAL ACTION: Text for TTS (${ttsProvider}, ${language}, ${voice}, ${startTime}-${endTime}): "${textToSynthesize.substring(
            0,
            100
          )}..."`
        );

        // 5. Call appropriate TTS function
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

        // 6. Upload TTS chunk
        console.log(
          `INTERNAL ACTION: Uploading TTS chunk to: ${chunkStoragePath}`
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
          `INTERNAL ACTION: TTS chunk uploaded to: ${chunkStoragePath}`
        );

        // 7. Insert record into translated_audio_chunks
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
            "INTERNAL ACTION: DB Error inserting translated chunk record:",
            dbInsertError.message
          );
          // Don't throw, log and continue
        } else if (dbInsertError?.code === "23505") {
          console.warn(
            `INTERNAL ACTION: Race condition: translated_audio_chunk for ${chunkStoragePath} inserted concurrently.`
          );
        }

        // 8. Return the storage path
        console.log(
          `INTERNAL ACTION: Returning chunk storage path: ${chunkStoragePath}`
        );
        return { success: true, data: { storagePath: chunkStoragePath } };
      } catch (error: unknown) {
        console.error("INTERNAL ACTION: Error generating audio chunk:", error);
        const appErr =
          error instanceof AppError
            ? error
            : new AppError(
                AppErrorCode.UNEXPECTED_ERROR,
                error instanceof Error
                  ? error.message
                  : "Unknown error in internalGenerateAudioChunk"
              );
        return { success: false, error: appErr };
      }
    }
  );

// TODO: Refactor common helper functions (e.g., extractTextFromSegments) if needed
