"use server";

// Remove unused import
// import { createSafeActionClient } from "next-safe-action";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import OpenAI from "openai"; // Import OpenAI class
import { Buffer } from "buffer"; // Import Buffer if not already globally available
import Replicate from "replicate";
import type { User } from "@supabase/supabase-js"; // Re-import User type for assertion
import { translateText } from "@/lib/translation";
// Import generated types
import type { Database, Tables, Enums } from "@/types/supabase";
import { protectedAction } from "./safe-action";
import { supabaseServiceRoleClient } from "@/lib/supabase/serviceRoleClient";
import { ActionResponse, AppError, AppErrorCode, appErrors } from "./actions";

// Comment out unused OpenAI client for now
// import { openai, translateTextOpenAI } from "@/lib/openai";

// Define REPLICATE_WEBHOOK_URL at the top level for easier access
const REPLICATE_WEBHOOK_URL = process.env.REPLICATE_WEBHOOK_URL;

// Comment out unused variable
// const DOWNLOAD_SERVICE_URL =
//   process.env.DOWNLOADER_SERVICE_URL || "http://83.27.167.60:1777/process";

// Remove unused action variable
// const action = createSafeActionClient();

// Constants
const DOWNLOAD_SERVICE_URL = process.env.DOWNLOADER_SERVICE_URL;
const AUDIO_SEGMENTER_URL = process.env.AUDIO_SEGMENTER_URL;
const AUDIO_SEGMENTER_SECRET_KEY = process.env.AUDIO_SEGMENTER_SECRET_KEY;
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
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
if (!REPLICATE_API_TOKEN) console.error("REPLICATE_API_TOKEN is not set.");
if (!OPENAI_API_KEY) console.error("OPENAI_API_KEY is not set.");
if (!process.env.NEXT_PUBLIC_APP_URL)
  console.error("NEXT_PUBLIC_APP_URL is not set (needed for webhook).");

// --- Replicate Client Initialization ---
const replicate = new Replicate({
  auth: REPLICATE_API_TOKEN,
});

// --- OpenAI Client Initialization ---
// const openai = new OpenAI({ apiKey: OPENAI_API_KEY }); // Defer initialization until needed in generateAudioChunk

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
          const response = await fetch(`${downloaderServiceUrl}/process`, {
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
  start: number;
  end: number;
  word: string;
  speaker?: string; // Optional: Include if your model provides it
}
interface ReplicateSegment {
  start: number;
  end: number;
  text: string;
  words: TranscriptionWord[];
  speaker?: string; // Optional: Include if your model provides it
}
interface ReplicateSegmentOutput {
  segments: ReplicateSegment[];
  // detected_language?: string; // Optional: Include if provided
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
        const { data: segmentsData, error: segmentsError } = await supabase
          .from("transcription_segments") // Use string literal
          .select("content")
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
        // Use existing RECORD_NOT_FOUND code
        if (!segmentsData || segmentsData.length === 0) {
          throw new AppError(
            AppErrorCode.RECORD_NOT_FOUND,
            "Transcription not available for the requested time."
          );
        }

        // 3. Extract text for the exact time range [startTime, endTime]
        let textToTranslate = "";
        (segmentsData as Tables<"transcription_segments">[] | null)?.forEach(
          (segment) => {
            // Use generated type for content, ensuring it's an object first
            let content: ReplicateSegmentOutput | null = null;
            if (
              segment.content &&
              typeof segment.content === "object" &&
              !Array.isArray(segment.content)
            ) {
              // Now it's safer to potentially cast, although validation is better
              // For now, we assume the structure matches if it's an object
              content = segment.content as unknown as ReplicateSegmentOutput; // Use unknown cast
            }

            if (!content?.segments || !Array.isArray(content.segments)) return;

            content.segments.forEach((sentence: ReplicateSegment) => {
              // Add explicit type
              if (!sentence?.words || !Array.isArray(sentence.words)) return;
              sentence.words.forEach((word: TranscriptionWord) => {
                // Add explicit type
                const wordStart = word?.start ?? -1;
                const wordEnd = word?.end ?? -1;
                const wordText = word?.word ?? "";

                if (wordStart >= 0 && wordEnd >= 0 && wordText) {
                  if (
                    Math.max(wordStart, startTime) < Math.min(wordEnd, endTime)
                  ) {
                    textToTranslate += wordText + " ";
                  }
                }
              });
            });
          }
        );
        textToTranslate = textToTranslate.trim();

        if (!textToTranslate) {
          console.warn(
            `No words found overlapping the range ${startTime}-${endTime}.`
          );
          // Use existing RECORD_NOT_FOUND code
          throw new AppError(
            AppErrorCode.RECORD_NOT_FOUND,
            "No transcription text found for the precise time range."
          );
        }

        console.log(
          `Text for TTS (${language}, ${ttsVoice}, ${startTime}-${endTime}): "${textToTranslate.substring(
            0,
            100
          )}..."`
        );

        // 4. Call OpenAI TTS
        const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
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
        // Use AppErrorCode here
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
interface CompletedSegmentOutput {
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
        const { data, error } = await supabase
          .from("transcription_segments") // Use string literal
          .select("start_time, end_time, content")
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
          return {
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
  console.log(
    `Calling Audio Segmenter at ${AUDIO_SEGMENTER_URL} for video ${videoId} (${startTime}-${endTime})`
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
        start_time: startTime,
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
  console.log(
    `Calling Replicate (${replicateModelVersion}) for: ${audioUrl} with webhook ${REPLICATE_WEBHOOK_URL}`
  );
  try {
    const prediction = await replicate.predictions.create({
      version: replicateModelVersion,
      input: {
        audio: audioUrl,
      },
      webhook: REPLICATE_WEBHOOK_URL,
      webhook_events_filter: ["completed"],
    });

    if (!prediction.id) {
      throw new Error("Replicate did not return a prediction ID");
    }
    console.log("Replicate prediction started:", prediction.id);
    return prediction.id;
  } catch (error: unknown) {
    console.error("Replicate API Error:", error);
    const message =
      error instanceof Error ? error.message : "Unknown Replicate error";
    throw new AppError(
      AppErrorCode.REPLICATE_API_ERROR,
      `Replicate transcription failed to start: ${message}`
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
          // Use optional chaining after the cast
          console.log(
            `Segment ${videoId} (${startTime}-${endTime}) already exists/processing (Status: ${
              (existingSegment as Tables<"transcription_segments"> | null)
                ?.status ?? "unknown"
            }). Skipping.`
          );
          return { success: true, data: { success: true } };
        }

        // 2. Get audio segment path from microservice
        const segmentStoragePath = await getAudioSegmentPath(
          videoId,
          startTime,
          endTime
        );

        // 3. Get signed URL for the segment
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
        console.log(`Got signed URL for segment`);

        // 4. Create placeholder record (pending)
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

        // 5. Start Replicate Transcription - Hardcode the model version here
        const replicatePredictionId = await startReplicateTranscription(
          segmentSignedUrl,
          "thomasmol/whisper-diarization:d8bc5908738ebd84a9bb7d77d94b9c5e5a3d867886791d7171ddb60455b4c6af"
        );

        // 6. Update DB record with Replicate ID (processing)
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
        }

        console.log(
          `Transcription segment request successful for ${videoId} (${startTime}-${endTime}), Replicate ID: ${replicatePredictionId}`
        );
        return { success: true, data: { success: true } };
      } catch (error: unknown) {
        console.error(`Error in requestTranscriptionSegment:`, error);
        const appErr =
          error instanceof AppError
            ? error
            : new AppError(
                AppErrorCode.UNEXPECTED_ERROR,
                error instanceof Error
                  ? error.message
                  : "Unknown error in requestTranscriptionSegment"
              );
        return { success: false, error: appErr };
      }
    }
  );
