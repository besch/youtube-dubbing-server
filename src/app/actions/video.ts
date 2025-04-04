"use server";

import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import OpenAI from "openai";
import { Buffer } from "buffer";
import Replicate from "replicate";
import type { User } from "@supabase/supabase-js";
import type { Tables } from "@/types/supabase";
import { protectedAction } from "./safe-action";
import { supabaseServiceRoleClient } from "@/lib/supabase/serviceRoleClient";
import { ActionResponse, AppError, AppErrorCode, appErrors } from "./actions";
import { config } from "@/config";
import Anthropic from "@anthropic-ai/sdk";

// Define REPLICATE_WEBHOOK_URL at the top level for easier access
const REPLICATE_WEBHOOK_URL = process.env.REPLICATE_WEBHOOK_URL;

// Constants
const DOWNLOAD_SERVICE_URL = process.env.DOWNLOADER_SERVICE_URL;
const AUDIO_SEGMENTER_URL = process.env.AUDIO_SEGMENTER_URL;
const AUDIO_SEGMENTER_SECRET_KEY = process.env.AUDIO_SEGMENTER_SECRET_KEY;
const REPLICATE_API_KEY = process.env.REPLICATE_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Re-define TTS Voices constant for Zod enums
type OpenAiTtsVoice = "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";
const OPENAI_TTS_VOICES: [OpenAiTtsVoice, ...OpenAiTtsVoice[]] = [
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
];

// --- Environment Variable Checks ---
if (!DOWNLOAD_SERVICE_URL) console.error("DOWNLOADER_SERVICE_URL is not set.");
if (!AUDIO_SEGMENTER_URL) console.error("AUDIO_SEGMENTER_URL is not set.");
if (!AUDIO_SEGMENTER_SECRET_KEY)
  console.error("AUDIO_SEGMENTER_SECRET_KEY is not set.");
if (!REPLICATE_API_KEY) console.error("REPLICATE_API_KEY is not set.");
if (!OPENAI_API_KEY) console.error("OPENAI_API_KEY is not set.");
if (!process.env.NEXT_PUBLIC_APP_URL)
  console.error("NEXT_PUBLIC_APP_URL is not set (needed for webhook).");
if (!config.apiKeys.anthropic)
  // Check for Anthropic key from config
  console.error("ANTHROPIC_API_KEY is not set.");

// --- Replicate Client Initialization ---
const replicate = new Replicate({
  auth: REPLICATE_API_KEY,
});

// --- OpenAI Client Initialization ---
const openai = new OpenAI({ apiKey: OPENAI_API_KEY }); // Defer initialization until needed in generateAudioChunk

// --- Anthropic Client Initialization ---
const anthropic = new Anthropic({
  apiKey: config.apiKeys.anthropic, // Use key from config
});

// Helper to extract YouTube Video ID - throws error if not found
function extractYoutubeVideoId(url: string): string {
  try {
    const parsedUrl = new URL(url);
    let videoId: string | null = null;

    if (parsedUrl.hostname === "youtu.be") {
      videoId = parsedUrl.pathname.slice(1);
    }
    if (
      parsedUrl.hostname === "www.youtube.com" ||
      parsedUrl.hostname === "youtube.com"
    ) {
      if (parsedUrl.pathname === "/watch") {
        videoId = parsedUrl.searchParams.get("v");
      }
      if (parsedUrl.pathname.startsWith("/embed/")) {
        videoId = parsedUrl.pathname.split("/")[2];
      }
      if (parsedUrl.pathname.startsWith("/shorts/")) {
        videoId = parsedUrl.pathname.split("/shorts/")[1];
      }
    }

    if (videoId) {
      // Basic check for valid characters and length
      if (/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        return videoId;
      } else {
        console.warn("Extracted potential ID, but failed validation:", videoId);
      }
    }
  } catch (error) {
    console.error("Error parsing YouTube URL:", error);
    throw new AppError(
      AppErrorCode.INVALID_INPUT,
      "Could not parse the provided YouTube URL."
    );
  }
  // If no valid ID found after checks
  throw new AppError(
    AppErrorCode.INVALID_INPUT,
    "Could not extract a valid YouTube video ID from the URL."
  );
}

// Zod schema for input validation
const startVideoProcessingSchema = z.object({
  youtubeUrl: z.string().url("Invalid YouTube URL"),
  // userId: z.string().uuid().optional(), // userId is now taken from context
});

interface StartProcessingOutput {
  videoId: string; // UUID from our DB
  downloadJobId: string; // UUID for the download job
  status: "initiated" | "exists"; // Indicates if processing started or video already exists
}

export const startVideoProcessing = protectedAction
  .schema(startVideoProcessingSchema)
  .action(
    async ({
      parsedInput,
      ctx,
    }): Promise<ActionResponse<StartProcessingOutput>> => {
      // Use type assertion for ctx.user.id
      const userId = (ctx as { user: User }).user.id;
      const { youtubeUrl } = parsedInput;

      const downloaderServiceUrl = process.env.DOWNLOADER_SERVICE_URL;
      if (!downloaderServiceUrl) {
        console.error(
          "DOWNLOADER_SERVICE_URL is not set in environment variables."
        );
        throw appErrors.UNEXPECTED_ERROR;
      }

      let youtubeId: string;
      try {
        youtubeId = extractYoutubeVideoId(youtubeUrl);
      } catch (error) {
        if (error instanceof AppError) {
          return { success: false, error: error };
        }
        console.error("Unexpected error during YouTube ID extraction:", error);
        return { success: false, error: appErrors.INVALID_INPUT };
      }

      try {
        const supabase = supabaseServiceRoleClient;

        // Use const for variables not reassigned
        const { data: existingVideo, error: videoCheckError } = await supabase
          .from("videos")
          .select("id")
          .eq("youtube_id", youtubeId)
          .maybeSingle();

        if (videoCheckError) {
          console.error("Error checking for existing video:", videoCheckError);
          throw appErrors.DATABASE_ERROR;
        }

        let videoId: string;

        if (existingVideo) {
          videoId = existingVideo.id;
          const { data: existingJob, error: jobCheckError } = await supabase
            .from("download_jobs")
            .select("id, status")
            .eq("video_id", videoId)
            .in("status", ["completed", "processing"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (jobCheckError) {
            console.error(
              "Error checking for existing download job:",
              jobCheckError
            );
          }

          if (
            existingJob?.status === "completed" ||
            existingJob?.status === "processing"
          ) {
            console.log(
              `Video ${youtubeId} (DB ID: ${videoId}) already downloaded or is processing (Job: ${existingJob.id}, Status: ${existingJob.status}).`
            );
            return {
              success: true,
              data: {
                videoId: videoId,
                downloadJobId: existingJob.id,
                status: "exists",
              },
            };
          }
          console.log(
            `Existing job for video ${videoId} is not completed or processing. Creating a new download job.`
          );
        } else {
          console.log(
            `Video ${youtubeId} not found in DB. Creating new record.`
          );
          const { data: newVideo, error: insertVideoError } = await supabase
            .from("videos")
            .insert({
              youtube_id: youtubeId,
            })
            .select("id")
            .single();

          if (insertVideoError) {
            if (insertVideoError.code === "23505") {
              console.warn(
                `Race condition: Video ${youtubeId} inserted concurrently. Fetching existing.`
              );
              const { data: raceVideo, error: raceError } = await supabase
                .from("videos")
                .select("id")
                .eq("youtube_id", youtubeId)
                .single();
              if (raceError || !raceVideo) {
                console.error(
                  "Error fetching video after race condition:",
                  raceError
                );
                throw appErrors.DATABASE_ERROR;
              }
              videoId = raceVideo.id;
            } else {
              console.error("Error inserting new video:", insertVideoError);
              throw appErrors.DATABASE_ERROR;
            }
          } else {
            videoId = newVideo.id;
            console.log(
              `Created new video record ${videoId} for YouTube ID ${youtubeId}`
            );
          }
        }

        const downloadJobId = uuidv4();
        console.log(
          `Creating new download job ${downloadJobId} for video ${videoId}`
        );

        const { error: insertJobError } = await supabase
          .from("download_jobs")
          .insert({
            id: downloadJobId,
            video_id: videoId,
            user_id: userId,
            status: "pending",
          });

        if (insertJobError) {
          console.error("Error inserting new download job:", insertJobError);
          throw appErrors.DATABASE_ERROR;
        }

        try {
          console.log(
            `Triggering downloader service for job ${downloadJobId} at ${downloaderServiceUrl}`
          );
          const response = await fetch(`${downloaderServiceUrl}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              youtube_url: youtubeUrl,
              job_id: downloadJobId,
            }),
          });

          if (!response.ok) {
            const responseBody = await response.text();
            console.error(
              `Downloader service rejected the request for job ${downloadJobId}: ${response.status} ${response.statusText}`,
              responseBody
            );
            await supabaseServiceRoleClient
              .from("download_jobs")
              .update({
                status: "failed",
                error_message: `Downloader service rejected request: ${response.status}`,
              })
              .eq("id", downloadJobId);
            throw appErrors.DOWNLOADER_SERVICE_ERROR;
          }

          const downloaderResponse = await response.json();
          console.log("Downloader service response:", downloaderResponse);
          if (
            downloaderResponse.status &&
            downloaderResponse.status !== "processing" &&
            downloaderResponse.status !== "completed"
          ) {
            console.warn(
              `Downloader service returned status ${downloaderResponse.status} in initial response for job ${downloadJobId}. Expecting status update via DB.`
            );
          }
        } catch (fetchError) {
          console.error(
            `Network error calling downloader service for job ${downloadJobId}:`,
            fetchError
          );
          await supabaseServiceRoleClient
            .from("download_jobs")
            .update({
              status: "failed",
              error_message:
                "Failed to trigger downloader service (network error)",
            })
            .eq("id", downloadJobId);
          throw appErrors.DOWNLOADER_SERVICE_ERROR;
        }

        console.log(
          `Successfully initiated download job ${downloadJobId} for video ${videoId}`
        );
        return {
          success: true,
          data: {
            videoId: videoId,
            downloadJobId: downloadJobId,
            status: "initiated",
          },
        };
      } catch (error) {
        console.error("Error caught in startVideoProcessing action:", error);
        // Ensure thrown errors are AppError instances or handle appropriately
        if (error instanceof AppError) {
          // Re-throw the AppError to be handled by safe-action's handleServerError
          throw error;
        }
        // Wrap unexpected errors in a generic AppError
        throw appErrors.UNEXPECTED_ERROR;
      }
    }
  );

// Define expected structure from transcription_segments.content
// **IMPORTANT**: Adjust these interfaces to match your actual Replicate model output
interface TranscriptionWord {
  start?: number; // Mark as optional if sometimes missing
  end?: number;
  word?: string;
  speaker?: string; // Optional: Include if your model provides it
}
interface ReplicateSegment {
  start: number; // Assume these are present in valid segments
  end: number;
  text: string;
  words: TranscriptionWord[];
  speaker?: string; // Optional: Include if your model provides it
}
interface ReplicateSegmentOutput {
  segments: ReplicateSegment[];
  detected_language?: string; // Optional: Include if provided and needed
}

// --- Action: Generate Audio Chunk (Revised) ---
const generateAudioChunkSchema = z
  .object({
    videoId: z.string().uuid(),
    language: z.string(),
    voice: z.string(), // Keep as string for flexibility, validation happens later
    startTime: z.number().min(0),
    endTime: z.number().min(0),
  })
  .refine((data) => data.endTime > data.startTime, {
    message: "End time must be greater than start time",
    path: ["endTime"],
  });

type GenerateAudioChunkOutput = {
  storagePath: string;
  publicUrl: string;
  startTime: number; // Echo back start time
  endTime: number; // Echo back end time
};

export const generateAudioChunk = protectedAction
  .schema(generateAudioChunkSchema)
  .action(
    async ({
      parsedInput,
      ctx,
    }): Promise<ActionResponse<{ publicUrl: string }>> => {
      const { videoId, language, voice, startTime, endTime } = parsedInput;
      const supabase = supabaseServiceRoleClient;
      type OpenAiTtsVoice =
        | "alloy"
        | "echo"
        | "fable"
        | "onyx"
        | "nova"
        | "shimmer";
      const VALID_TTS_VOICES: Set<OpenAiTtsVoice> = new Set([
        "alloy",
        "echo",
        "fable",
        "onyx",
        "nova",
        "shimmer",
      ]);

      if (!VALID_TTS_VOICES.has(voice as OpenAiTtsVoice)) {
        return {
          success: false,
          error: new AppError(
            AppErrorCode.INVALID_INPUT,
            `Invalid voice specified: ${voice}`
          ),
        };
      }
      const ttsVoice = voice as OpenAiTtsVoice;

      console.log(
        `Generating audio chunk for: ${videoId}, Lang: ${language}, Voice: ${ttsVoice}, Time: ${startTime}-${endTime}`
      );

      try {
        // 1. Check if exact chunk already exists
        const { data: existingChunk, error: checkError } = await supabase
          .from("translated_audio_chunks") // Use string literal
          .select("storage_path")
          .eq("video_id", videoId)
          .eq("language", language)
          .eq("voice", ttsVoice)
          .eq("chunk_start", startTime)
          .eq("chunk_end", endTime)
          .maybeSingle();

        if (checkError)
          throw new AppError(
            AppErrorCode.DATABASE_ERROR,
            `DB error checking chunk: ${checkError.message}`
          );

        // Use type assertion with generated type
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

        // 2. Fetch relevant COMPLETED transcription segments
        const { data: segmentsDataUntyped, error: segmentsError } =
          await supabase
            .from("transcription_segments")
            .select("id, start_time, end_time, translations") // Select id, times, translations
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

        // Use type assertion as workaround for potentially stale generated types
        const segmentsData = segmentsDataUntyped as any[] | null;

        if (!segmentsData || segmentsData.length === 0) {
          throw new AppError(
            AppErrorCode.RECORD_NOT_FOUND,
            "Completed transcription not available for the requested time."
          );
        }

        // 3. Extract *translated* text for the exact time range [startTime, endTime]
        let textToTranslate = "";
        (segmentsData || [])?.forEach((segment) => {
          let translatedContent: ReplicateSegmentOutput | null = null;
          const segmentTranslations = segment.translations as Record<
            string,
            any
          > | null;

          if (segmentTranslations && segmentTranslations[language]) {
            const langTranslation = segmentTranslations[language];
            if (
              langTranslation &&
              typeof langTranslation === "object" &&
              !Array.isArray(langTranslation) &&
              "segments" in langTranslation &&
              Array.isArray(langTranslation.segments)
            ) {
              translatedContent = langTranslation as ReplicateSegmentOutput;
            }
          }

          if (!translatedContent) {
            console.error(
              `Translation for language '${language}' not found in segment ${segment.id} (time ${segment.start_time}-${segment.end_time})`
            );
            throw new AppError(
              AppErrorCode.TRANSLATION_NOT_AVAILABLE,
              `Translation for '${language}' not ready for time ${segment.start_time?.toFixed(
                1
              )}s.`
            );
          }

          if (!translatedContent?.segments) return;

          translatedContent.segments.forEach((sentence: ReplicateSegment) => {
            const sentenceStart = sentence?.start ?? -1;
            const sentenceEnd = sentence?.end ?? -1;
            const sentenceText = sentence?.text ?? "";

            if (sentenceStart >= 0 && sentenceEnd >= 0 && sentenceText) {
              if (
                Math.max(sentenceStart, startTime) <
                Math.min(sentenceEnd, endTime)
              ) {
                textToTranslate += sentenceText + " "; // Append sentence text
              }
            }
          });
        });
        textToTranslate = textToTranslate.trim();

        if (!textToTranslate) {
          throw new AppError(
            AppErrorCode.RECORD_NOT_FOUND,
            `No translated text found for the precise time range ${startTime}-${endTime} in ${language}.`
          );
        }

        console.log(
          `Text for TTS (${language}, ${ttsVoice}, ${startTime}-${endTime}): "${textToTranslate.substring(
            0,
            100
          )}..."`
        );

        // 4. Call OpenAI TTS
        const ttsResponse = await openai.audio.speech.create({
          model: "tts-1",
          voice: ttsVoice,
          input: textToTranslate,
          response_format: "mp3",
        });

        if (!ttsResponse.body) {
          throw new AppError(
            AppErrorCode.SERVICE_ERROR,
            "OpenAI TTS failed: No response body"
          );
        }
        const audioBuffer = Buffer.from(await ttsResponse.arrayBuffer());

        // 5. Upload TTS chunk
        const chunkFileName = `${videoId}_${language}_${ttsVoice}_${startTime.toFixed(
          2
        )}_${endTime.toFixed(2)}.mp3`;
        const chunkStoragePath = `${videoId}/${language}/${chunkFileName}`;
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

        // 6. Insert record into translated_audio_chunks
        const { error: dbInsertError } = await supabase
          .from("translated_audio_chunks") // Use string literal
          .insert({
            video_id: videoId,
            language: language,
            voice: ttsVoice,
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

        // 7. Get signed URL for the new chunk
        const { data: finalUrlData, error: finalUrlError } =
          await supabase.storage
            .from("translated-audio")
            .createSignedUrl(chunkStoragePath, 60 * 5);

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

        console.log(`Returning new chunk URL: ${finalUrlData.signedUrl}`);
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

// --- Action: Update History --- //
const updateHistorySchema = z.object({
  // Use dbVideoId for consistency with other actions?
  // videoId: z.string().uuid(),
  dbVideoId: z.string().uuid(), // Renaming input field
  position: z.number().min(0),
  language: z.string(),
  voice: z.enum(OPENAI_TTS_VOICES), // Use the defined constant
});

export const updateHistory = protectedAction
  .schema(updateHistorySchema)
  .action(async ({ parsedInput, ctx }): Promise<ActionResponse<null>> => {
    const userId = ctx.user.id;
    const { dbVideoId, position, language, voice } = parsedInput;

    try {
      const { error } = await supabaseServiceRoleClient.from("history").upsert(
        {
          user_id: userId,
          video_id: dbVideoId,
          language: language,
          voice: voice,
          last_position: position,
          watched_at: new Date().toISOString(),
        },
        {
          onConflict: "user_id, video_id, language, voice",
        }
      );

      if (error) {
        console.error(
          `Error upserting watch history for user ${userId}, video ${dbVideoId}:`,
          error
        );
        throw appErrors.DATABASE_ERROR;
      }

      console.log(
        `Updated history for user ${userId}, video ${dbVideoId} to position ${position}`
      );
      return { success: true, data: null };
    } catch (error) {
      console.error("Error in updateHistory action:", error);
      throw error; // Let handleServerError manage it
    }
  });

// --- Toggle Favorite Action --- //
const toggleFavoriteSchema = z.object({
  dbVideoId: z.string().uuid(),
  language: z.string(),
  voice: z.enum(OPENAI_TTS_VOICES), // Use the defined constant
});

type ToggleFavoriteOutput = {
  isFavorite: boolean;
};

export const toggleFavorite = protectedAction
  .schema(toggleFavoriteSchema)
  .action(
    async ({
      parsedInput,
      ctx,
    }): Promise<ActionResponse<ToggleFavoriteOutput>> => {
      const userId = ctx.user.id;
      const { dbVideoId, language, voice } = parsedInput;

      try {
        // Check if favorite already exists
        const { data: existingFavorite, error: checkError } =
          await supabaseServiceRoleClient
            .from("favorites")
            .select("id")
            .eq("user_id", userId)
            .eq("video_id", dbVideoId)
            .eq("language", language)
            .eq("voice", voice)
            .maybeSingle();

        if (checkError) {
          console.error("Error checking favorite status:", checkError);
          throw appErrors.DATABASE_ERROR;
        }

        let isNowFavorite: boolean;

        if (existingFavorite) {
          // Exists, so delete it (unfavorite)
          console.log(`Unfavoriting video ${dbVideoId} for user ${userId}`);
          const { error: deleteError } = await supabaseServiceRoleClient
            .from("favorites")
            .delete()
            .match({ id: existingFavorite.id });

          if (deleteError) {
            console.error("Error deleting favorite:", deleteError);
            throw appErrors.DATABASE_ERROR;
          }
          isNowFavorite = false;
        } else {
          // Does not exist, so insert it (favorite)
          console.log(`Favoriting video ${dbVideoId} for user ${userId}`);
          const { error: insertError } = await supabaseServiceRoleClient
            .from("favorites")
            .insert({
              user_id: userId,
              video_id: dbVideoId,
              language: language,
              voice: voice,
            });

          if (insertError) {
            console.error("Error inserting favorite:", insertError);
            throw appErrors.DATABASE_ERROR;
          }
          isNowFavorite = true;
        }

        return { success: true, data: { isFavorite: isNowFavorite } };
      } catch (error) {
        console.error("Error in toggleFavorite action:", error);
        throw error; // Let handleServerError manage it
      }
    }
  );

// --- Get Favorite Status Action --- //
const getFavoriteStatusSchema = z.object({
  dbVideoId: z.string().uuid(),
  language: z.string(),
  voice: z.enum(OPENAI_TTS_VOICES), // Use the defined constant
});

// Output type is the same as ToggleFavoriteOutput
type GetFavoriteStatusOutput = ToggleFavoriteOutput;

export const getFavoriteStatus = protectedAction
  .schema(getFavoriteStatusSchema)
  .action(
    async ({
      parsedInput,
      ctx,
    }): Promise<ActionResponse<GetFavoriteStatusOutput>> => {
      const userId = ctx.user.id;
      const { dbVideoId, language, voice } = parsedInput;

      try {
        // Check if favorite exists
        const {
          data: existingFavorite,
          error: checkError,
          count,
        } = await supabaseServiceRoleClient
          .from("favorites")
          .select("id", { count: "exact", head: true }) // Just check existence efficiently
          .eq("user_id", userId)
          .eq("video_id", dbVideoId)
          .eq("language", language)
          .eq("voice", voice);

        if (checkError) {
          console.error("Error checking favorite status:", checkError);
          throw appErrors.DATABASE_ERROR;
        }

        const isFavorite = (count ?? 0) > 0;

        console.log(
          `Favorite status for user ${userId}, video ${dbVideoId}: ${isFavorite}`
        );
        return { success: true, data: { isFavorite: isFavorite } };
      } catch (error) {
        console.error("Error in getFavoriteStatus action:", error);
        throw error; // Let handleServerError manage it
      }
    }
  );

// --- Action: Get Completed Transcription Segments ---
const getCompletedTranscriptionSegmentsSchema = z.object({
  videoId: z.string().uuid(),
});

// Define the output structure matching the ReplicateSegmentOutput interface defined earlier
// **MODIFIED**: Added optional id
interface CompletedSegmentOutput {
  id?: string; // Added optional id
  start_time: number;
  end_time: number;
  content: ReplicateSegmentOutput | null;
}

export const getCompletedTranscriptionSegments = protectedAction
  .schema(getCompletedTranscriptionSegmentsSchema)
  .action(
    async ({
      parsedInput,
      ctx,
    }): Promise<ActionResponse<CompletedSegmentOutput[]>> => {
      const { videoId } = parsedInput;
      const supabase = supabaseServiceRoleClient;

      console.log(
        `Fetching completed transcription segments for video: ${videoId}`
      );

      try {
        // Use generated types
        // **MODIFIED**: Added 'id' to select
        const { data, error } = await supabase
          .from("transcription_segments") // Use string literal
          .select("id, start_time, end_time, content") // Added 'id'
          .eq("video_id", videoId)
          .eq("status", "completed")
          .order("start_time", { ascending: true });

        if (error) {
          throw new AppError(
            AppErrorCode.DATABASE_ERROR,
            `DB error fetching segments: ${error.message}`
          );
        }

        // Ensure content is cast correctly or handled if null
        const results: CompletedSegmentOutput[] = (
          (data as Tables<"transcription_segments">[] | null) || []
        ).map((segment) => {
          let contentResult: ReplicateSegmentOutput | null = null;
          if (
            segment.content &&
            typeof segment.content === "object" &&
            !Array.isArray(segment.content)
          ) {
            // Assuming structure matches if it's an object
            contentResult =
              segment.content as unknown as ReplicateSegmentOutput; // Use unknown cast
          }
          // **MODIFIED**: Include id in the result
          return {
            id: segment.id, // Include the id
            start_time: segment.start_time,
            end_time: segment.end_time,
            content: contentResult,
          };
        });

        console.log(
          `Found ${results.length} completed segments for video ${videoId}`
        );
        return { success: true, data: results };
      } catch (error: unknown) {
        console.error(`Error in getCompletedTranscriptionSegments:`, error);
        const appErr =
          error instanceof AppError
            ? error
            : new AppError(
                AppErrorCode.UNEXPECTED_ERROR,
                error instanceof Error
                  ? error.message
                  : "Unknown error fetching segments"
              );
        return { success: false, error: appErr };
      }
    }
  );

// --- Helper: Call Audio Segmenter Microservice ---
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
    `Calling Audio Segmenter at ${AUDIO_SEGMENTER_URL} for video ${videoId} (Sent Time: ${segmenterStartTime}-${endTime}, Original Start: ${startTime})`
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
      console.error(`Audio Segmenter Error (${response.status}): ${errorBody}`);
      let detailMessage = `Status ${response.status}: ${errorBody}`; // Default message
      try {
        const parsedError = JSON.parse(errorBody);
        // Prefer parsedError.detail if it's a string, otherwise stringify the whole object
        if (typeof parsedError.detail === "string") {
          detailMessage = parsedError.detail;
        } else {
          // Stringify the whole parsed object for more context
          detailMessage = JSON.stringify(parsedError);
        }
      } catch {
        // Parsing failed, stick with the raw errorBody
      }
      throw new AppError(
        AppErrorCode.AUDIO_SEGMENTER_ERROR,
        `Audio Segmenter failed: ${detailMessage}` // Use the refined message
      );
    }

    const data = await response.json();
    if (!data.segment_storage_path) {
      console.error(
        "Audio Segmenter response missing segment_storage_path:",
        data
      );
      throw new AppError(
        AppErrorCode.SERVICE_ERROR,
        "Audio Segmenter did not return segment path"
      );
    }
    console.log(`Audio Segmenter returned path: ${data.segment_storage_path}`);
    return data.segment_storage_path;
  } catch (error: unknown) {
    console.error("Error calling Audio Segmenter:", error);
    if (error instanceof AppError) throw error;
    const message =
      error instanceof Error ? error.message : "Unknown communication error";
    throw new AppError(
      AppErrorCode.SERVICE_ERROR,
      `Failed to communicate with Audio Segmenter: ${message}`
    );
  }
}

// --- Helper: Start Replicate Transcription ---
async function startReplicateTranscription(
  audioUrl: string,
  replicateModelVersion: string
): Promise<string> {
  // Enhanced Log
  console.log(
    `Replicate: Preparing to call model ${replicateModelVersion}. Audio URL starts with: ${audioUrl.substring(
      0,
      150
    )}... Webhook URL: ${REPLICATE_WEBHOOK_URL}`
  );
  if (!REPLICATE_WEBHOOK_URL) {
    // Added check
    console.error("Replicate Error: REPLICATE_WEBHOOK_URL is not set!");
    throw new AppError(
      AppErrorCode.CONFIGURATION_ERROR,
      "Replicate webhook URL is not configured."
    );
  }
  if (!replicate) {
    // Added check
    console.error("Replicate Error: Replicate client is not initialized!");
    throw new AppError(
      AppErrorCode.CONFIGURATION_ERROR,
      "Replicate client failed to initialize."
    );
  }

  try {
    // Log inputs right before the call
    console.log(
      `Replicate: Calling replicate.predictions.create with version: ${replicateModelVersion}, webhook: ${REPLICATE_WEBHOOK_URL}`
    );
    const prediction = await replicate.predictions.create({
      // Use the hardcoded version directly as identified in requestTranscriptionSegment
      version:
        "84d2ad2d6194fe98a17d2b60bef1c7f910c46b2f6fd38996ca457afd9c8abfcb",
      input: {
        // Ensure input format matches the model's expectation
        audio_file: audioUrl, // Changed from 'audio' to 'audio_file' based on error log
        // language: "en", // Optional: Specify language if needed by the model
        // model: "large-v3" // Optional: Specify sub-model if applicable
      },
      webhook: REPLICATE_WEBHOOK_URL,
      webhook_events_filter: ["completed"], // Ensure this matches what webhook handler expects
    });

    if (!prediction?.id) {
      // Check prediction object itself as well
      console.error(
        "Replicate Error: API call succeeded but returned no prediction ID. Prediction object:",
        JSON.stringify(prediction, null, 2)
      ); // Log the full prediction object stringified
      throw new Error("Replicate did not return a prediction ID");
    }
    console.log(
      "Replicate: Prediction started successfully. ID:",
      prediction.id
    ); // Log success
    return prediction.id;
  } catch (error: unknown) {
    // Log the raw error *before* wrapping it
    console.error(
      "Replicate Error: Caught error during predictions.create():",
      error // Log the actual error object
    );
    // Log details if it's an AxiosError or similar structure
    if (typeof error === "object" && error !== null && "response" in error) {
      const axiosError = error as {
        response?: { data?: any; status?: number; headers?: any };
      };
      console.error(
        "Replicate Error Response Data:",
        axiosError.response?.data
      );
      console.error(
        "Replicate Error Response Status:",
        axiosError.response?.status
      );
      console.error(
        "Replicate Error Response Headers:",
        axiosError.response?.headers
      );
    }

    // Construct a more informative message
    const message =
      error instanceof Error ? error.message : "Unknown Replicate API error";
    let detailedMessage = `Replicate transcription failed to start: ${message}`;
    // Attempt to extract more details if available (e.g., from Replicate's error structure)
    if (typeof error === "object" && error !== null && "toString" in error) {
      detailedMessage += ` | Details: ${error.toString()}`;
    }

    throw new AppError(
      AppErrorCode.REPLICATE_API_ERROR,
      detailedMessage // Use the more detailed message
    );
  }
}

// --- Action: Request Transcription Segment (New) ---
const requestTranscriptionSegmentSchema = z
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

export const requestTranscriptionSegment = protectedAction
  .schema(requestTranscriptionSegmentSchema)
  .action(
    async ({
      parsedInput,
      ctx,
    }): Promise<ActionResponse<{ success: boolean }>> => {
      const { videoId, startTime, endTime } = parsedInput;
      const supabase = supabaseServiceRoleClient;

      console.log(
        `Requesting transcription segment for video ${videoId} from ${startTime} to ${endTime}`
      );

      try {
        console.log(
          `RequestSegment: Checking for existing segment: Video=${videoId}, Start=${startTime}, End=${endTime}`
        );
        // 1. Check if segment already exists/processing
        const { data: existingSegment, error: checkError } = await supabase
          .from("transcription_segments") // Use string literal
          .select("id, status")
          .eq("video_id", videoId)
          .eq("start_time", startTime)
          .eq("end_time", endTime)
          .maybeSingle();

        // Explicitly check if checkError exists before accessing message
        if (checkError) {
          throw new AppError(
            AppErrorCode.DATABASE_ERROR,
            `DB error checking segment: ${checkError.message}`
          );
        }

        if (existingSegment) {
          // Check the status before skipping
          if (existingSegment.status !== "pending") {
            console.log(
              `RequestSegment: Found existing segment for ${videoId} (${startTime}-${endTime}). Status: ${existingSegment.status}. Skipping new Replicate request.`
            );
            return { success: true, data: { success: true } };
          } else {
            // Log that we are proceeding despite finding a pending segment
            console.log(
              `RequestSegment: Found existing segment for ${videoId} (${startTime}-${endTime}) with status 'pending'. Proceeding to request/start Replicate job.`
            );
            // Allow the code execution to continue below to retry the process
          }
        }

        // 2. Get audio segment path from microservice
        console.log(
          `RequestSegment: Calling getAudioSegmentPath for video ${videoId} (${startTime}-${endTime})`
        );
        const segmentStoragePath = await getAudioSegmentPath(
          videoId,
          startTime,
          endTime
        );
        console.log(
          `RequestSegment: Received segmentStoragePath: ${segmentStoragePath}`
        );

        // 3. Get signed URL for the segment
        console.log(
          `RequestSegment: Getting signed URL for path: ${segmentStoragePath}`
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
          `RequestSegment: Got signed URL: ${segmentSignedUrl.substring(
            0,
            100
          )}...`
        ); // Log part of the URL

        // 4. Create placeholder record (pending)
        console.log(
          `RequestSegment: Creating placeholder DB record for segment ${videoId} (${startTime}-${endTime})`
        );
        const { data: dbSegment, error: insertError } = await supabase
          .from("transcription_segments") // Use string literal
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
            `Race condition: Segment ${videoId} (${startTime}-${endTime}) inserted concurrently. Skipping request.`
          );
          return { success: true, data: { success: true } };
        } else if (insertError) {
          throw new AppError(
            AppErrorCode.DATABASE_ERROR,
            `DB error inserting segment: ${insertError.message}`
          );
        }
        if (!dbSegment)
          throw new AppError(
            AppErrorCode.DATABASE_ERROR,
            "Failed to insert segment record or get ID."
          );
        const dbSegmentId = (dbSegment as Tables<"transcription_segments">).id;
        console.log(
          `RequestSegment: Created DB segment record with ID: ${dbSegmentId}`
        );

        // 5. Start Replicate Transcription - Hardcode the model version here
        const modelVersion = // Keep the specific version hardcoded here
          "victor-upmeet/whisperx:84d2ad2d6194fe98a17d2b60bef1c7f910c46b2f6fd38996ca457afd9c8abfcb";
        console.log(
          `RequestSegment: Attempting to start Replicate transcription (Model Version: ${modelVersion}) for segment ${dbSegmentId} using URL starting with: ${segmentSignedUrl.substring(
            0,
            100
          )}...`
        );
        const replicatePredictionId = await startReplicateTranscription(
          segmentSignedUrl,
          modelVersion // Pass the version string
        );
        console.log(
          `RequestSegment: Successfully started Replicate. Received Prediction ID: ${replicatePredictionId} for DB segment ${dbSegmentId}`
        );

        // 6. Update DB record with Replicate ID (processing)
        console.log(
          `RequestSegment: Updating DB segment ${dbSegmentId} with Replicate ID ${replicatePredictionId} and status 'processing'`
        );
        const { error: updateError } = await supabase
          .from("transcription_segments") // Use string literal
          .update({
            replicate_prediction_id: replicatePredictionId,
            status: "processing",
          })
          .eq("id", dbSegmentId);

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
          `RequestSegment: Successfully completed request for ${videoId} (${startTime}-${endTime}), Replicate ID: ${replicatePredictionId}` // Added prefix
        );
        return { success: true, data: { success: true } };
      } catch (error: unknown) {
        console.error(`RequestSegment: Error caught in main try block:`, error); // Added prefix
        const appErr =
          error instanceof AppError
            ? error
            : new AppError(
                AppErrorCode.UNEXPECTED_ERROR,
                error instanceof Error
                  ? error.message
                  : "Unknown error in requestTranscriptionSegment"
              );
        // Explicitly log the error object being returned
        console.error(
          `RequestSegment: Returning failure response with error:`,
          JSON.stringify(appErr, null, 2)
        );
        return { success: false, error: appErr };
      }
    }
  );

// --- New Action: Translate Segment Content ---
const translateSegmentContentSchema = z.object({
  segmentId: z.string().uuid(),
  targetLanguage: z.string().length(2), // ISO 639-1 code
});

// Helper function to format transcription for Anthropic prompt
function formatTranscriptionForAnthropic(
  segments: ReplicateSegment[] | undefined | null
): string {
  if (!segments || !Array.isArray(segments)) return "";
  let batch = "";
  segments.forEach((segment, index) => {
    if (
      segment &&
      typeof segment.start === "number" &&
      typeof segment.end === "number" &&
      typeof segment.text === "string"
    ) {
      batch += `${index + 1}
`;
      batch += `${segment.start.toFixed(3)} --> ${segment.end.toFixed(3)}
`;
      batch += `${segment.text}

`;
    }
  });
  return batch.trim(); // Remove trailing newline
}

// Helper function to parse Anthropic response back into structure
function parseAnthropicResponse(
  anthropicText: string,
  originalSegments: ReplicateSegment[]
): ReplicateSegment[] | null {
  try {
    const lines = anthropicText.trim().split("\n");
    const translatedSegments: ReplicateSegment[] = [];
    let lineIndex = 0;

    while (lineIndex < lines.length) {
      const numLine = lines[lineIndex++]?.trim();
      if (!numLine || !/^[0-9]+$/.test(numLine)) continue;

      const timeLine = lines[lineIndex++]?.trim();
      if (!timeLine || !timeLine.includes("-->")) continue; // Basic check for timestamp format

      const textLine = lines[lineIndex++]?.trim();
      if (textLine === undefined) continue;

      // Consume potential empty lines until next number or EOF
      while (lineIndex < lines.length && lines[lineIndex]?.trim() === "") {
        lineIndex++;
      }

      const originalIndex = parseInt(numLine, 10) - 1;
      const original = originalSegments[originalIndex];

      if (
        original &&
        typeof original.start === "number" &&
        typeof original.end === "number"
      ) {
        translatedSegments.push({
          start: original.start,
          end: original.end,
          text: textLine,
          words: [],
        });
      } else {
        console.warn(
          `Parsing Anthropic: Could not find original segment for index ${originalIndex} or times missing`
        );
      }
    }

    if (
      translatedSegments.length === 0 &&
      originalSegments.length > 0 &&
      anthropicText.length > 0
    ) {
      // Added check for non-empty input
      console.warn(
        `Parsing Anthropic: Failed to parse any segments from non-empty response.`
      );
      return null;
    } else if (translatedSegments.length !== originalSegments.length) {
      console.warn(
        `Parsing Anthropic: Mismatch in segment count. Original: ${originalSegments.length}, Translated: ${translatedSegments.length}`
      );
    }

    return translatedSegments;
  } catch (error) {
    console.error("Error parsing Anthropic response:", error);
    console.error("Anthropic Raw Response Text:", anthropicText);
    return null;
  }
}

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

      const segmentData = segmentDataUntyped as any;
      // Cast safely, defaulting to an empty object if null/undefined
      const existingTranslations = (segmentData.translations ?? {}) as Record<
        string,
        ReplicateSegmentOutput
      >;

      // --- START: Check if translation exists ---
      if (existingTranslations[targetLanguage]) {
        console.log(
          `>>> translateSegmentContent: Translation for ${targetLanguage} already exists for segment ${segmentId}. Forcing Realtime trigger via update.`
        );
        // Force an update by setting the field to its current value.
        // The updated_at trigger will ensure Realtime fires.
        const { error: forceUpdateError } = await supabase
          .from("transcription_segments")
          .update({ translations: existingTranslations as any }) // Re-set same value
          .eq("id", segmentId);

        if (forceUpdateError) {
          console.error(
            `>>> translateSegmentContent: DB Force Update Error for segment ${segmentId}:`,
            forceUpdateError
          );
          // Throw error even if forcing, as something went wrong with the DB
          throw new AppError(
            AppErrorCode.DATABASE_ERROR,
            `DB error forcing update for segment ${segmentId}: ${forceUpdateError.message}`
          );
        } else {
          console.log(
            `>>> translateSegmentContent: DB Force Update successful for segment ${segmentId}. Realtime event should trigger.`
          );
          // Return success because the requested translation data exists.
          return { success: true, data: null };
        }
      }
      // --- END: Check if translation exists ---
      else {
        // --- Translation does NOT exist, proceed with API call ---
        console.log(
          `>>> translateSegmentContent: Translation for ${targetLanguage} not found for segment ${segmentId}. Proceeding with API call.`
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
          // Use a known error code for now
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
          return { success: true, data: null };
        }

        const textToTranslate = formatTranscriptionForAnthropic(
          originalContent.segments
        );
        if (!textToTranslate) {
          console.log(`No text found to translate in segment ${segmentId}.`);
          return { success: true, data: null };
        }

        console.log(
          `Calling Anthropic to translate ${sourceLangName} to ${targetLangName} for segment ${segmentId}`
        );

        // 4. Call Anthropic API
        const response = await anthropic.messages.create({
          model: "claude-3-haiku-20240307",
          max_tokens: 2500,
          messages: [
            {
              role: "user",
              content: `Translate the following subtitles from ${sourceLangName} to ${targetLangName}.\nMaintain the exact same timing and numbering format.\nCritical formatting rules:\n1. Each subtitle entry MUST be separated by exactly one empty line\n2. Each entry MUST follow this exact format (no square brackets):\n[number]\n[timestamp like 0.000 --> 0.000]\n[translated text]\n[empty line]\n3. The last subtitle entry MUST be followed by an empty line\n4. Never include multiple consecutive empty lines\n5. Preserve all original numbering and timing exactly as provided\n\n${textToTranslate}`,
            },
          ],
          temperature: 0.3,
        });

        if (
          !response.content ||
          !response.content[0] ||
          response.content[0].type !== "text"
        ) {
          throw new AppError(
            AppErrorCode.SERVICE_ERROR,
            "Anthropic translation failed: Invalid response structure."
          );
        }
        const translatedText = response.content[0].text;

        // 5. Parse Anthropic Response
        const parsedSegments = parseAnthropicResponse(
          translatedText,
          originalContent.segments
        );
        if (!parsedSegments) {
          throw new AppError(
            AppErrorCode.SERVICE_ERROR,
            `Failed to parse Anthropic translation response for segment ${segmentId}. Raw: ${translatedText.substring(
              0,
              100
            )}`
          );
        }

        const translatedContent: ReplicateSegmentOutput = {
          segments: parsedSegments,
          // We can optionally add the target language here if needed later
          // detected_language: targetLanguage
        };

        // 6. Update Database with the *new* translation
        const updatedTranslations = {
          ...((segmentData.translations || {}) as object),
          [targetLanguage]: translatedContent,
        };

        // Log before the DB update
        console.log(
          `>>> translateSegmentContent: Attempting to update DB for segment ${segmentId} with translations: ${JSON.stringify(
            updatedTranslations
          )}`
        );
        const { error: updateError } = await supabase
          .from("transcription_segments")
          .update({ translations: updatedTranslations as any }) // Keep 'as any' until types are updated
          .eq("id", segmentId);

        // Log after the DB update, checking for errors
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
      // Simplify error reporting for now
      const appErr =
        error instanceof AppError ? error : appErrors.UNEXPECTED_ERROR;
      return { success: false, error: appErr };
    }
  });

// --- Action: Get Favorites ---

// Define output structure for a single favorite item
const FavoriteItemSchema = z.object({
  favoriteId: z.string().uuid(),
  videoId: z.string().uuid(), // The DB video ID
  youtubeId: z.string(),
  title: z.string().nullable().optional(),
  thumbnailUrl: z.string().url().nullable().optional(),
  duration: z.number().int().positive().nullable().optional(),
  language: z.string(),
  voice: z.string(), // Keep as string, validated by DB enum/usage
  addedAt: z.string().datetime(),
});
export type FavoriteItem = z.infer<typeof FavoriteItemSchema>;

export const getFavorites = protectedAction
  // No input schema needed, userId comes from context
  .action(async ({ ctx }): Promise<ActionResponse<FavoriteItem[]>> => {
    const userId = ctx.user.id;
    const supabase = supabaseServiceRoleClient;

    console.log(`Fetching favorites for user: ${userId}`);

    try {
      const { data, error } = await supabase
        .from("favorites")
        .select(
          `
          id, 
          added_at,
          language,
          voice,
          video_id,
          videos ( youtube_id, title, thumbnail_url, duration )
        `
        )
        .eq("user_id", userId)
        .order("added_at", { ascending: false });

      if (error) {
        console.error(`DB error fetching favorites for user ${userId}:`, error);
        throw appErrors.DATABASE_ERROR;
      }

      if (!data) {
        return { success: true, data: [] }; // Return empty array if no favorites
      }

      // Transform data and validate
      const favorites: FavoriteItem[] = data
        .map((fav) => {
          // Type assertion for joined video table
          const video = fav.videos as Tables<"videos"> | null;
          if (!video) return null; // Skip if video data is missing (shouldn't happen with inner join logic)

          return {
            favoriteId: fav.id,
            videoId: fav.video_id,
            youtubeId: video.youtube_id,
            title: video.title ?? null,
            thumbnailUrl: video.thumbnail_url ?? null,
            duration: video.duration ?? null,
            language: fav.language,
            voice: fav.voice,
            addedAt: fav.added_at,
          };
        })
        .filter((item) => item !== null); // Filter out nulls from skipped videos

      // Validate the final array structure
      const validation = z.array(FavoriteItemSchema).safeParse(favorites);
      if (!validation.success) {
        console.error("Favorites data validation failed:", validation.error);
        throw new AppError(
          AppErrorCode.UNEXPECTED_ERROR,
          "Failed to validate favorites data structure."
        );
      }

      console.log(
        `Found ${validation.data.length} favorites for user ${userId}`
      );
      return { success: true, data: validation.data };
    } catch (error: unknown) {
      console.error(`Error in getFavorites action for user ${userId}:`, error);
      const appErr =
        error instanceof AppError ? error : appErrors.UNEXPECTED_ERROR;
      return { success: false, error: appErr };
    }
  });

// --- Action: Get History ---

const HistoryItemSchema = z.object({
  historyId: z.string().uuid(),
  videoId: z.string().uuid(), // DB video ID
  youtubeId: z.string(),
  title: z.string().nullable().optional(),
  thumbnailUrl: z.string().url().nullable().optional(),
  duration: z.number().int().positive().nullable().optional(),
  language: z.string(),
  voice: z.string(),
  lastPosition: z.number().min(0),
  watchedAt: z.string().datetime(),
});
export type HistoryItem = z.infer<typeof HistoryItemSchema>;

export const getHistory = protectedAction
  // No input schema needed
  .action(async ({ ctx }): Promise<ActionResponse<HistoryItem[]>> => {
    const userId = ctx.user.id;
    const supabase = supabaseServiceRoleClient;

    console.log(`Fetching history for user: ${userId}`);

    try {
      const { data, error } = await supabase
        .from("history")
        .select(
          `
          id,
          watched_at,
          language,
          voice,
          last_position,
          video_id,
          videos ( youtube_id, title, thumbnail_url, duration )
        `
        )
        .eq("user_id", userId)
        .order("watched_at", { ascending: false })
        .limit(50); // Limit history items for performance

      if (error) {
        console.error(`DB error fetching history for user ${userId}:`, error);
        throw appErrors.DATABASE_ERROR;
      }

      if (!data) {
        return { success: true, data: [] };
      }

      // Transform data
      const history: HistoryItem[] = data
        .map((item) => {
          const video = item.videos as Tables<"videos"> | null;
          if (!video) return null;

          return {
            historyId: item.id,
            videoId: item.video_id,
            youtubeId: video.youtube_id,
            title: video.title ?? null,
            thumbnailUrl: video.thumbnail_url ?? null,
            duration: video.duration ?? null,
            language: item.language,
            voice: item.voice,
            lastPosition: item.last_position,
            watchedAt: item.watched_at,
          };
        })
        .filter((item) => item !== null);

      const validation = z.array(HistoryItemSchema).safeParse(history);
      if (!validation.success) {
        console.error("History data validation failed:", validation.error);
        throw new AppError(
          AppErrorCode.UNEXPECTED_ERROR,
          "Failed to validate history data structure."
        );
      }

      console.log(
        `Found ${validation.data.length} history items for user ${userId}`
      );
      return { success: true, data: validation.data };
    } catch (error: unknown) {
      console.error(`Error in getHistory action for user ${userId}:`, error);
      const appErr =
        error instanceof AppError ? error : appErrors.UNEXPECTED_ERROR;
      return { success: false, error: appErr };
    }
  });
