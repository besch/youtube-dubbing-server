"use server";

import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import type { User } from "@supabase/supabase-js";
import type { Tables } from "@/types/supabase";
import { protectedAction } from "./safe-action";
import { supabaseServiceRoleClient } from "@/lib/supabase/serviceRoleClient";
import { ActionResponse, AppError, AppErrorCode, appErrors } from "./actions";
import { config } from "@/config";
import {
  formatTranscriptionForTranslation,
  parseTranslationResponse,
  translateText,
} from "@/lib/translate";
import {
  startReplicateTranscription,
  type ReplicateSegment,
  type ReplicateSegmentOutput,
} from "@/lib/replicate";
import {
  generateOpenAiTts,
  VALID_TTS_VOICES,
  type OpenAiTtsVoice,
} from "@/lib/openai-tts";

// Constants
const AUDIO_SEGMENTER_URL = process.env.AUDIO_SEGMENTER_URL;
const AUDIO_SEGMENTER_SECRET_KEY = process.env.AUDIO_SEGMENTER_SECRET_KEY;
// Use the imported constant for Zod enum definition
const OPENAI_TTS_VOICES_ARRAY = Array.from(VALID_TTS_VOICES) as [
  OpenAiTtsVoice,
  ...OpenAiTtsVoice[]
];

// --- Environment Variable Checks ---
if (!AUDIO_SEGMENTER_URL) console.error("AUDIO_SEGMENTER_URL is not set.");
if (!AUDIO_SEGMENTER_SECRET_KEY)
  console.error("AUDIO_SEGMENTER_SECRET_KEY is not set.");
if (!process.env.NEXT_PUBLIC_APP_URL)
  console.error("NEXT_PUBLIC_APP_URL is not set (needed for webhook).");
if (!config.apiKeys.anthropic)
  // Check for Anthropic key from config
  console.error("ANTHROPIC_API_KEY is not set.");

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

// --- Helper Function: Extract Text from Segments for Time Range ---
function extractTextFromSegments(
  segmentsOutputs: (ReplicateSegmentOutput | null | undefined)[],
  targetStartTime: number,
  targetEndTime: number
): string {
  let extractedText = "";
  const addedSentences = new Set<string>(); // Avoid duplicating sentences if segments overlap

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
          !addedSentences.has(sentenceText) // Check if already added
        ) {
          // Check for overlap: max(start1, start2) < min(end1, end2)
          if (
            Math.max(sentenceStart, targetStartTime) <
            Math.min(sentenceEnd, targetEndTime)
          ) {
            // For simplicity, include the whole sentence if it overlaps.
            // More precise clipping might be desired but adds complexity.
            extractedText += sentenceText + " ";
            addedSentences.add(sentenceText); // Mark sentence as added
          }
        }
      }
    }
  }
  return extractedText.trim();
}
// --- End Helper Function ---

// Zod schema for input validation
const startVideoProcessingSchema = z.object({
  youtubeUrl: z.string().url("Invalid YouTube URL"),
  // userId: z.string().uuid().optional(), // userId is now taken from context
});

interface StartProcessingOutput {
  videoId: string;
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
            `Video ${youtubeId} not found in DB. Fetching metadata and creating record.`
          );

          // --- Fetch Metadata via oEmbed ---
          let fetchedTitle: string | null = null;
          let fetchedThumbnailUrl: string | null = null;
          // Duration is not provided by oEmbed, keep as null for now
          const duration: number | null = null; // Duration remains hard to get reliably here

          try {
            const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
              youtubeUrl
            )}&format=json`;
            console.log(`Fetching oEmbed metadata from: ${oembedUrl}`);
            const oembedResponse = await fetch(oembedUrl);

            if (!oembedResponse.ok) {
              // Handle cases like private videos (401/403) or not found (404)
              // Log specific status for debugging
              console.warn(
                `oEmbed request for ${youtubeId} failed with status ${oembedResponse.status}.`
              );
              // Don't throw an error here, just proceed without metadata.
              // The video record will be created with defaults.
            } else {
              const oembedData = await oembedResponse.json();
              fetchedTitle = oembedData.title || null; // Use null if undefined/empty
              fetchedThumbnailUrl = oembedData.thumbnail_url || null; // Use null if undefined/empty
              console.log(`Fetched oEmbed metadata for ${youtubeId}:`, {
                title: fetchedTitle,
                thumbnailUrl: fetchedThumbnailUrl,
              });
            }
          } catch (metaError: any) {
            console.warn(
              `Failed to fetch or parse metadata for ${youtubeId}:`,
              metaError?.message || metaError
            );
            // Proceed without metadata, columns allow NULL
          }

          // Use fetched title or default, ensure thumbnail is null if not fetched
          const videoTitle = fetchedTitle || "Untitled Video";
          const videoThumbnail = fetchedThumbnailUrl; // Directly use null if not fetched

          const { data: newVideo, error: insertVideoError } = await supabase
            .from("videos")
            .insert({
              youtube_id: youtubeId,
              title: videoTitle, // Use the fetched or default title
              thumbnail_url: videoThumbnail, // Use the fetched or null thumbnail
              duration: duration, // Still null for now
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

        // ADD THIS LOG:
        console.log(
          `[startVideoProcessing] About to fetch downloader service. Job ID: ${downloadJobId}, URL: ${youtubeUrl}`
        );

        // 1. Insert the job record first
        const { error: insertJobError } = await supabase
          .from("download_jobs")
          .insert({
            id: downloadJobId,
            video_id: videoId,
            user_id: userId,
            status: "pending", // Start as pending
          });

        if (insertJobError) {
          console.error("Error inserting new download job:", insertJobError);
          // If insertion fails, don't proceed to call the downloader
          throw appErrors.DATABASE_ERROR;
        }

        // 2. Trigger the downloader service asynchronously (fire-and-forget)
        // We don't await the full response, just initiate the request.
        const requestBody = {
          youtube_url: youtubeUrl,
          job_id: downloadJobId, // This should be the correct ID
        };
        console.log(
          "[startVideoProcessing] Body OBJECT being sent to downloader:",
          requestBody
        );

        fetch(`${downloaderServiceUrl}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody), // Send the logged object
        }).catch(async (fetchError) => {
          // Log the error, but don't block the main action from returning.
          // The job status will remain 'pending' until the downloader updates it,
          // or it might need manual intervention/retry logic later.
          console.error(
            `Failed to *initiate* fetch call to downloader service for job ${downloadJobId}:`,
            fetchError
          );
          // Optionally: Update the job status to 'failed' immediately if triggering fails catastrophically
          // await supabaseServiceRoleClient
          //   .from("download_jobs")
          //   .update({ status: 'failed', error_message: 'Failed to trigger downloader service' })
          //   .eq('id', downloadJobId);
        });

        // 3. Return success to the client immediately
        // The client will rely on Realtime updates for the actual download status.
        console.log(
          `Successfully requested download job ${downloadJobId} for video ${videoId}. Returning control to client.`
        );
        return {
          success: true,
          data: {
            videoId: videoId,
            downloadJobId: downloadJobId,
            status: "initiated", // Indicate the process has started, not completed
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

export const generateAudioChunk = protectedAction
  .schema(generateAudioChunkSchema)
  .action(
    async ({
      parsedInput,
      ctx,
    }): Promise<ActionResponse<{ publicUrl: string }>> => {
      const { videoId, language, voice, startTime, endTime } = parsedInput;
      const supabase = supabaseServiceRoleClient;

      // Validate voice using the imported constant/type
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

        // --- 3. Extract Text for the Specific Time Range & Language ---
        let textToSynthesize = "";

        if (language === "en") {
          // If English, use the original transcription content
          const originalContents: ReplicateSegmentOutput[] = [];
          for (const segment of segmentsData) {
            if (!segment.content) {
              // Throw specific error if original content is missing for EN
              console.warn(
                `Original transcription content missing for segment ${segment.id} (${segment.start_time}-${segment.end_time}) needed for English TTS.`
              );
              throw new AppError(
                AppErrorCode.DEPENDENCY_NOT_READY,
                `Original transcription not ready for time ${segment.start_time}s.` // More accurate error
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
          // If not English, use the translated content
          const translatedContents: ReplicateSegmentOutput[] = [];
          for (const segment of segmentsData) {
            const translation = segment.translations?.[language];
            if (!translation) {
              console.warn(
                `Translation for '${language}' not found for segment ${segment.id} (${segment.start_time}-${segment.end_time}).`
              );
              throw new AppError(
                AppErrorCode.DEPENDENCY_NOT_READY,
                `Translation for '${language}' not ready for time ${segment.start_time}s.`
              );
            }
            // Ensure the translation structure matches ReplicateSegmentOutput if needed
            // This might require validation or adjustment depending on the actual structure
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
            `No translated text found for the precise time range ${startTime}-${endTime} in ${language}.`
          );
        }

        console.log(
          `Text for TTS (${language}, ${ttsVoice}, ${startTime}-${endTime}): "${textToSynthesize.substring(
            0,
            100
          )}..."`
        );

        // 4. Call the refactored TTS function
        const { audioBuffer, storagePath: chunkStoragePath } =
          await generateOpenAiTts({
            text: textToSynthesize,
            voice: ttsVoice,
            videoId,
            language,
            startTime,
            endTime,
          });

        // 5. Upload TTS chunk
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
  voice: z.enum(OPENAI_TTS_VOICES_ARRAY), // Use the array derived from the set
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
  voice: z.enum(OPENAI_TTS_VOICES_ARRAY), // Use the array derived from the set
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
      } catch (error: unknown) {
        console.error("Caught raw error in toggleFavorite action:", error); // Log the raw error
        // Ensure we always throw an AppError
        if (error instanceof AppError) {
          console.log("Re-throwing existing AppError:", error.toJSON()); // Log the AppError JSON
          throw error; // Re-throw if already AppError
        } else {
          // Wrap other errors in a generic DATABASE_ERROR or UNEXPECTED_ERROR
          // Check if it's likely a Supabase error structure (heuristic)
          let message = "Failed to toggle favorite status.";
          if (
            typeof error === "object" &&
            error !== null &&
            "message" in error &&
            typeof error.message === "string"
          ) {
            message = error.message; // Use Supabase error message if available
          }
          console.log(`Wrapping error with message: '${message}'`); // Log the message being used
          const wrappedError = new AppError(
            AppErrorCode.DATABASE_ERROR,
            message
          );
          console.log(
            "Throwing newly wrapped AppError:",
            wrappedError.toJSON()
          ); // Log the wrapped AppError JSON
          throw wrappedError;
        }
      }
    }
  );

// --- Get Favorite Status Action --- //
const getFavoriteStatusSchema = z.object({
  dbVideoId: z.string().uuid(),
  language: z.string(),
  voice: z.enum(OPENAI_TTS_VOICES_ARRAY), // Use the array derived from the set
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
          .select("id, start_time, end_time, content, translations") // Added 'id' and 'translations'
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
          // **MODIFIED**: Include id and translations in the result
          return {
            id: segment.id, // Include the id
            start_time: segment.start_time,
            end_time: segment.end_time,
            content: contentResult,
            translations: segment.translations, // Include translations
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

        let dbSegmentId: string;
        let shouldProceed = true;

        if (existingSegment) {
          // Check the status before skipping
          if (
            existingSegment.status === "completed" ||
            existingSegment.status === "processing"
          ) {
            console.log(
              `RequestSegment: Found existing segment for ${videoId} (${startTime}-${endTime}). Status: ${existingSegment.status}. Skipping.`
            );
            shouldProceed = false;
          } else {
            // Status is pending or failed (allow retry for failed?)
            // Log that we are proceeding despite finding a pending segment
            console.log(
              `RequestSegment: Found existing segment for ${videoId} (${startTime}-${endTime}) with status '${existingSegment.status}'. Proceeding to update and start Replicate job.`
            );
            dbSegmentId = existingSegment.id;
            // Allow the code execution to continue below to retry the process
          }
        }

        // Exit early if segment is already completed or processing
        if (!shouldProceed) {
          return { success: true, data: { success: true } };
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
        );

        // 4. Insert or identify existing segment ID
        console.log(
          `RequestSegment: Ensuring DB record exists for segment ${videoId} (${startTime}-${endTime})`
        );

        // Only insert if dbSegmentId is not already set (meaning no pending/failed segment was found)
        if (!dbSegmentId!) {
          const { data: dbSegment, error: insertError } = await supabase
            .from("transcription_segments")
            .insert({
              video_id: videoId,
              start_time: startTime,
              end_time: endTime,
              status: "pending", // Start as pending before Replicate call
              segment_storage_path: segmentStoragePath,
            })
            .select("id")
            .single();

          if (insertError && insertError.code === "23505") {
            // This case should ideally be less frequent now, but handle it. Fetch the existing ID.
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
            `RequestSegment: Inserted/Confirmed DB segment record with ID: ${dbSegmentId}`
          );
        } else {
          console.log(
            `RequestSegment: Using existing DB segment record with ID: ${dbSegmentId}`
          );
        }

        // 5. Start Replicate Transcription - Hardcode the model version here
        console.log(
          `RequestSegment: Attempting to start Replicate transcription for segment ${dbSegmentId} using URL starting with: ${segmentSignedUrl.substring(
            0,
            100
          )}...`
        );
        const replicatePredictionId = await startReplicateTranscription(
          segmentSignedUrl
        );
        console.log(
          `RequestSegment: Successfully started Replicate. Received Prediction ID: ${replicatePredictionId} for DB segment ${dbSegmentId}`
        );

        // 6. Update DB record with Replicate ID (processing)
        console.log(
          `RequestSegment: Updating DB segment ${dbSegmentId!} with Replicate ID ${replicatePredictionId}, segment path, and status 'processing'`
        );
        const { error: updateError } = await supabase
          .from("transcription_segments") // Use string literal
          .update({
            replicate_prediction_id: replicatePredictionId,
            status: "processing",
            segment_storage_path: segmentStoragePath, // Update path in case it changed
          })
          .eq("id", dbSegmentId!); // Use the determined segment ID

        if (updateError) {
          console.error(
            `Failed to update segment ${dbSegmentId!} with Replicate ID ${replicatePredictionId}:`,
            updateError.message
          );
          throw new AppError(
            AppErrorCode.DATABASE_ERROR,
            `Failed to update segment status after starting Replicate: ${updateError.message}`
          );
        }

        console.log(
          `RequestSegment: Successfully updated/initiated segment ${dbSegmentId!} for ${videoId} (${startTime}-${endTime}), Replicate ID: ${replicatePredictionId}` // Added prefix
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
          `>>> translateSegmentContent: Translation for ${targetLanguage} already exists for segment ${segmentId}. Skipping API call and returning success.`
        );
        return { success: true, data: null };
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

        const textToTranslate = formatTranscriptionForTranslation(
          originalContent.segments
        );
        if (!textToTranslate) {
          console.log(`No text found to translate in segment ${segmentId}.`);
          return { success: true, data: null };
        }

        console.log(
          `Calling Translation Service (Gemini) to translate ${sourceLangName} to ${targetLangName} for segment ${segmentId}`
        );

        // 4. Call Translation Service (Gemini)
        const translatedText = await translateText(
          textToTranslate,
          sourceLangName,
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
            `Failed to parse translation response for segment ${segmentId}. Raw: ${translatedText.substring(
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
          `>>> translateSegmentContent: Attempting to update DB for segment ${segmentId} with translations for language ${targetLanguage}` // More specific log
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

      // Transform data first
      const mappedData = data
        .map((fav) => {
          const video = fav.videos as Tables<"videos"> | null;
          if (!video || !fav.added_at) {
            console.warn(
              `Skipping favorite ${fav.id} due to missing video or added_at data.`
            );
            return null; // Skip if essential data is missing
          }

          // Return the object structure, converting added_at
          return {
            favoriteId: fav.id,
            videoId: fav.video_id,
            youtubeId: video.youtube_id,
            title: video.title ?? null,
            thumbnailUrl: video.thumbnail_url ?? null,
            duration: video.duration ?? null,
            language: fav.language,
            voice: fav.voice,
            addedAt: new Date(fav.added_at).toISOString(), // Convert to ISO string
          };
        })
        .filter((item) => item !== null); // Filter out nulls

      // Now validate the filtered array against the Zod schema
      const validation = z.array(FavoriteItemSchema).safeParse(mappedData);

      if (!validation.success) {
        // Log the specific validation errors and potentially the data that failed
        console.error(
          "Favorites data validation failed:",
          validation.error.errors
        ); // Log specific errors
        // console.error("Data that failed validation:", JSON.stringify(mappedData, null, 2)); // Optional: Log the data
        throw new AppError(
          AppErrorCode.UNEXPECTED_ERROR,
          "Failed to validate favorites data structure."
        );
      }

      console.log(
        `Found ${validation.data.length} favorites for user ${userId}`
      );
      // Return the validated data
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
      const mappedData = data
        .map((item) => {
          const video = item.videos as Tables<"videos"> | null;
          if (!video || !item.watched_at) {
            console.warn(
              `Skipping history ${item.id} due to missing video or watched_at data.`
            );
            return null; // Skip if essential data is missing
          }

          // Return the object structure, converting watchedAt
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
            watchedAt: new Date(item.watched_at).toISOString(), // Convert to ISO string
          };
        })
        .filter((item) => item !== null);

      const validation = z.array(HistoryItemSchema).safeParse(mappedData);
      if (!validation.success) {
        console.error(
          "History data validation failed:",
          validation.error.errors
        );
        // console.error("Data that failed validation:", JSON.stringify(mappedData, null, 2)); // Optional: Log the data
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

// --- Action: Get Suggested Videos ---

const SuggestedVideoItemSchema = z.object({
  youtubeId: z.string(),
  title: z.string().nullable().optional(),
  thumbnailUrl: z.string().url().nullable().optional(),
});
export type SuggestedVideoItem = z.infer<typeof SuggestedVideoItemSchema>;

const getSuggestedVideosSchema = z.object({
  currentYoutubeId: z.string(),
});

export const getSuggestedVideos = protectedAction
  .schema(getSuggestedVideosSchema)
  .action(
    async ({
      parsedInput,
      ctx,
    }): Promise<ActionResponse<SuggestedVideoItem[]>> => {
      const { currentYoutubeId } = parsedInput;
      const supabase = supabaseServiceRoleClient;
      const userId = ctx.user.id; // Included for potential future use (e.g., personalized suggestions)

      console.log(
        `Fetching suggested videos, excluding: ${currentYoutubeId} for user ${userId}`
      );

      try {
        const { data, error } = await supabase
          .from("videos")
          .select("youtube_id, title, thumbnail_url") // Select the columns from DB
          .neq("youtube_id", currentYoutubeId) // Exclude the current video
          .order("created_at", { ascending: false }) // Get the most recent
          .limit(5); // Limit to 5 suggestions

        if (error) {
          console.error(
            `DB error fetching suggested videos (excluding ${currentYoutubeId}):`,
            error
          );
          throw appErrors.DATABASE_ERROR;
        }

        if (!data) {
          return { success: true, data: [] };
        }

        // Transform and validate data
        // Revert to using DB data directly, as it should now be populated correctly
        const mappedData = data.map((video) => ({
          youtubeId: video.youtube_id,
          title: video.title ?? "Untitled Video", // Use title from DB, fallback to 'Untitled Video'
          thumbnailUrl: video.thumbnail_url ?? null, // Use thumbnail from DB, fallback to null
        }));

        const validation = z
          .array(SuggestedVideoItemSchema)
          .safeParse(mappedData);
        if (!validation.success) {
          console.error(
            "Suggested videos data validation failed:",
            validation.error.errors
          );
          throw new AppError(
            AppErrorCode.UNEXPECTED_ERROR,
            "Failed to validate suggested videos data structure."
          );
        }

        console.log(`Found ${validation.data.length} suggested videos.`);
        return { success: true, data: validation.data };
      } catch (error: unknown) {
        console.error(
          `Error in getSuggestedVideos action (excluding ${currentYoutubeId}):`,
          error
        );
        const appErr =
          error instanceof AppError ? error : appErrors.UNEXPECTED_ERROR;
        return { success: false, error: appErr };
      }
    }
  );
