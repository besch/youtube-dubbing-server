"use server";

import { createSafeActionClient } from "next-safe-action";
import { z } from "zod";
import { appErrors } from "@/types/actions";
import {
  extractYoutubeId,
  isValidYoutubeUrl,
  getVideoInfo,
  downloadAudio,
} from "@/lib/youtube";
import { createAdminClient, createServerClient } from "@/lib/supabase";
import {
  transcribeAudio,
  translateText,
  generateAndUploadSpeech,
} from "@/lib/ai-services";
import { Voice, TranscriptionSegment } from "@/types";
import { v4 as uuidv4 } from "uuid"; // For generating job IDs
import type { ActionResponse } from "@/types/actions";
import { supabaseServerClient } from "@/lib/supabase/server";
import Replicate from "replicate";

const action = createSafeActionClient();

// Schema for processing a YouTube URL
const processYoutubeUrlSchema = z.object({
  url: z.string().url(),
  language: z.string().min(2).max(5),
  voice: z.enum(["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const),
});

export const processYoutubeUrl = action
  .schema(processYoutubeUrlSchema)
  .action(async ({ parsedInput }) => {
    const { url, language, voice } = parsedInput;

    try {
      // Check if the URL is valid
      if (!isValidYoutubeUrl(url)) {
        return { success: false, error: appErrors.INVALID_YOUTUBE_URL };
      }

      // Extract the video ID
      const videoId = extractYoutubeId(url);
      if (!videoId) {
        return { success: false, error: appErrors.INVALID_YOUTUBE_URL };
      }

      // Check authentication
      const supabase = createServerClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        return { success: false, error: appErrors.AUTHENTICATION_ERROR };
      }

      // Get or create video info
      const adminClient = createAdminClient();
      const { data: existingVideo } = await adminClient
        .from("videos")
        .select("*")
        .eq("youtube_id", videoId)
        .single();

      let dbVideoId: string;

      if (existingVideo) {
        dbVideoId = existingVideo.id;
      } else {
        // Get video info from YouTube Data API
        const videoInfo = await getVideoInfo(videoId);

        // Insert into the database
        const { data: newVideo, error } = await adminClient
          .from("videos")
          .insert({
            youtube_id: videoId,
            title: videoInfo.title,
            description: videoInfo.description,
            thumbnail_url: videoInfo.thumbnail_url,
            duration: videoInfo.duration,
          })
          .select()
          .single();

        if (error || !newVideo) {
          console.error("Error inserting video:", error);
          return { success: false, error: appErrors.DATABASE_ERROR };
        }

        dbVideoId = newVideo.id;
      }

      // Add to user's history
      await adminClient.from("history").upsert({
        user_id: session.user.id,
        video_id: dbVideoId,
        language,
        voice,
        watched_at: new Date().toISOString(),
        last_position: 0,
      });

      return {
        success: true,
        data: {
          videoId,
          dbVideoId,
        },
      };
    } catch (error) {
      console.error("Error processing YouTube URL:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? {
                code: "UNEXPECTED_ERROR",
                message: error.message,
              }
            : appErrors.UNEXPECTED_ERROR,
      };
    }
  });

// Schema for requesting a specific audio chunk
const getAudioChunkSchema = z.object({
  videoId: z.string(),
  dbVideoId: z.string().uuid(),
  startTime: z.number().min(0),
  endTime: z.number().min(0),
  language: z.string().min(2).max(5),
  voice: z.enum(["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const),
});

export const getAudioChunk = action
  .schema(getAudioChunkSchema)
  .action(async ({ parsedInput }) => {
    const { videoId, dbVideoId, startTime, endTime, language, voice } =
      parsedInput;

    try {
      // Check authentication
      const supabase = createServerClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        return { success: false, error: appErrors.AUTHENTICATION_ERROR };
      }

      // Check if we already have this audio chunk
      const adminClient = createAdminClient();
      const { data: existingChunk } = await adminClient
        .from("audio_chunks")
        .select("*")
        .eq("video_id", dbVideoId)
        .eq("language", language)
        .eq("voice", voice)
        .gte("start_time", startTime - 0.5) // Allow for small variations in start/end times
        .lte("end_time", endTime + 0.5)
        .single();

      if (existingChunk) {
        // We already have this chunk, return the URL
        const {
          data: { publicUrl },
        } = adminClient.storage
          .from("audio_chunks")
          .getPublicUrl(existingChunk.storage_path);

        return {
          success: true,
          data: {
            url: publicUrl,
            startTime: existingChunk.start_time,
            endTime: existingChunk.end_time,
          },
        };
      }

      // Check if we have a transcription for this time range
      const { data: existingTranscription } = await adminClient
        .from("transcriptions")
        .select("*")
        .eq("video_id", dbVideoId)
        .lte("chunk_start", startTime)
        .gte("chunk_end", endTime)
        .single();

      let transcriptionData: TranscriptionSegment[];

      if (existingTranscription) {
        // Use existing transcription
        transcriptionData = existingTranscription.content;
      } else {
        // We need to download and transcribe this chunk
        const audioFilePath = await downloadAudio(videoId, startTime, endTime);

        // Transcribe the audio
        const transcription = await transcribeAudio(audioFilePath, language);

        // Save the transcription
        const expiryAt = new Date();
        expiryAt.setDate(expiryAt.getDate() + 1); // 24 hours by default

        const { error } = await adminClient.from("transcriptions").insert({
          video_id: dbVideoId,
          chunk_start: startTime,
          chunk_end: endTime,
          content: transcription,
          expiry_at: expiryAt.toISOString(),
          is_favorite: false,
        });

        if (error) {
          console.error("Error saving transcription:", error);
          return { success: false, error: appErrors.DATABASE_ERROR };
        }

        transcriptionData = transcription;
      }

      // Generate text to speak based on the transcription
      // Filter segments that are within our time range
      const relevantSegments = Array.isArray(transcriptionData)
        ? transcriptionData.filter(
            (segment: TranscriptionSegment) =>
              segment.start >= startTime && segment.end <= endTime
          )
        : [];

      if (relevantSegments.length === 0) {
        return {
          success: false,
          error: {
            code: "NO_SPEECH_CONTENT",
            message: "No speech content found in this time range",
          },
        };
      }

      // Check if the user has favorited this video
      const { data: favorite } = await adminClient
        .from("favorites")
        .select("*")
        .eq("user_id", session.user.id)
        .eq("video_id", dbVideoId)
        .eq("language", language)
        .eq("voice", voice)
        .single();

      const isFavorite = !!favorite;

      // Generate and upload speeches for each segment
      const speakerVoiceMap: Record<string, Voice> = {};

      // Map speakers to voices if multiple speakers
      if (relevantSegments.length > 0) {
        const speakers = [
          ...new Set(
            relevantSegments.map(
              (segment: TranscriptionSegment) => segment.speaker
            )
          ),
        ];

        if (speakers.length > 1) {
          // If we have multiple speakers, assign different voices
          const availableVoices: Voice[] = [
            "alloy",
            "echo",
            "fable",
            "onyx",
            "nova",
            "shimmer",
          ];
          const userSelectedVoice = voice;

          // Put the user-selected voice first
          const voices = [
            userSelectedVoice,
            ...availableVoices.filter((v) => v !== userSelectedVoice),
          ];

          // Assign a voice to each speaker
          speakers.forEach((speaker, index) => {
            speakerVoiceMap[speaker] = voices[index % voices.length];
          });
        } else {
          // Only one speaker, use the selected voice
          speakerVoiceMap[relevantSegments[0].speaker] = voice;
        }
      }

      // Generate a combined text from all segments
      let combinedText = relevantSegments
        .map((segment: TranscriptionSegment) => segment.text)
        .join(" ");

      // Translate text if target language is different from transcription language
      // We assume transcription is in the original video language, typically English
      const transcriptionLanguage = "en"; // Default language for transcription
      if (language !== transcriptionLanguage) {
        try {
          console.log(
            `Translating from ${transcriptionLanguage} to ${language}`
          );
          combinedText = await translateText(
            combinedText,
            transcriptionLanguage,
            language
          );
        } catch (error) {
          console.error("Translation error:", error);
          // Continue with original text if translation fails
        }
      }

      // Generate and upload the audio
      const storagePath = await generateAndUploadSpeech(
        combinedText,
        voice,
        dbVideoId,
        language,
        startTime,
        endTime,
        isFavorite
      );

      // Get the public URL
      const {
        data: { publicUrl },
      } = adminClient.storage.from("audio_chunks").getPublicUrl(storagePath);

      return {
        success: true,
        data: {
          url: publicUrl,
          startTime,
          endTime,
        },
      };
    } catch (error) {
      console.error("Error getting audio chunk:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? {
                code: "UNEXPECTED_ERROR",
                message: error.message,
              }
            : appErrors.UNEXPECTED_ERROR,
      };
    }
  });

// Schema for updating watch history
const updateHistorySchema = z.object({
  videoId: z.string().uuid(),
  position: z.number().min(0),
});

export const updateHistory = action
  .schema(updateHistorySchema)
  .action(async ({ parsedInput }) => {
    const { videoId, position } = parsedInput;

    try {
      // Check authentication
      const supabase = createServerClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        return { success: false, error: appErrors.AUTHENTICATION_ERROR };
      }

      // Update the history
      const adminClient = createAdminClient();
      const { error } = await adminClient
        .from("history")
        .update({
          last_position: position,
          watched_at: new Date().toISOString(),
        })
        .eq("user_id", session.user.id)
        .eq("video_id", videoId);

      if (error) {
        console.error("Error updating history:", error);
        return { success: false, error: appErrors.DATABASE_ERROR };
      }

      return { success: true };
    } catch (error) {
      console.error("Error updating history:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? {
                code: "UNEXPECTED_ERROR",
                message: error.message,
              }
            : appErrors.UNEXPECTED_ERROR,
      };
    }
  });

// Schema for toggling favorite status
const toggleFavoriteSchema = z.object({
  videoId: z.string().uuid(),
  language: z.string().min(2).max(5),
  voice: z.enum(["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const),
});

export const toggleFavorite = action
  .schema(toggleFavoriteSchema)
  .action(async ({ parsedInput }) => {
    const { videoId, language, voice } = parsedInput;

    try {
      // Check authentication
      const supabase = createServerClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        return { success: false, error: appErrors.AUTHENTICATION_ERROR };
      }

      const adminClient = createAdminClient();

      // Check if already favorited
      const { data: existing } = await adminClient
        .from("favorites")
        .select("*")
        .eq("user_id", session.user.id)
        .eq("video_id", videoId)
        .eq("language", language)
        .eq("voice", voice)
        .single();

      if (existing) {
        // Remove from favorites
        const { error } = await adminClient
          .from("favorites")
          .delete()
          .eq("id", existing.id);

        if (error) {
          console.error("Error removing favorite:", error);
          return { success: false, error: appErrors.DATABASE_ERROR };
        }

        return { success: true, data: { isFavorite: false } };
      } else {
        // Add to favorites
        const { error } = await adminClient.from("favorites").insert({
          user_id: session.user.id,
          video_id: videoId,
          language,
          voice,
        });

        if (error) {
          console.error("Error adding favorite:", error);
          return { success: false, error: appErrors.DATABASE_ERROR };
        }

        return { success: true, data: { isFavorite: true } };
      }
    } catch (error) {
      console.error("Error toggling favorite:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? {
                code: "UNEXPECTED_ERROR",
                message: error.message,
              }
            : appErrors.UNEXPECTED_ERROR,
      };
    }
  });

// Environment variables
const DOWNLOAD_SERVICE_URL =
  process.env.DOWNLOAD_SERVICE_URL || "http://83.27.167.60:1777/process"; // Make it configurable

// Environment variables (ensure these are defined in your .env.local or environment)
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const REPLICATE_WEBHOOK_SECRET = process.env.REPLICATE_WEBHOOK_SECRET; // For webhook security
const NEXT_PUBLIC_VERCEL_URL =
  process.env.NEXT_PUBLIC_VERCEL_URL || process.env.VERCEL_URL; // URL of your deployment

if (!REPLICATE_API_TOKEN) {
  console.warn(
    "Missing env.REPLICATE_API_TOKEN. Transcription features will be disabled."
  );
}
if (!REPLICATE_WEBHOOK_SECRET) {
  console.warn(
    "Missing env.REPLICATE_WEBHOOK_SECRET. Replicate webhooks will be insecure."
  );
  // Potentially throw error in production if security is critical
}
if (!NEXT_PUBLIC_VERCEL_URL) {
  console.warn(
    "Missing NEXT_PUBLIC_VERCEL_URL or VERCEL_URL. Replicate webhook URL might be incorrect."
  );
  // Potentially throw error in production
}

const replicate = REPLICATE_API_TOKEN
  ? new Replicate({
      auth: REPLICATE_API_TOKEN,
    })
  : null;

const startTranscriptionSchema = z.object({
  jobId: z.string().uuid(), // ID of the completed download job
  // Optional parameters for Replicate model
  numSpeakers: z.number().int().optional(),
  prompt: z.string().optional(),
});

type StartTranscriptionInput = z.infer<typeof startTranscriptionSchema>;
type StartTranscriptionOutput = {
  transcriptionId: string;
  predictionId: string; // Replicate prediction ID
};

export const startTranscription = action(
  startTranscriptionSchema,
  async (
    input: StartTranscriptionInput
  ): Promise<ActionResponse<StartTranscriptionOutput>> => {
    const { jobId, numSpeakers, prompt } = input;
    let transcriptionRecordId: string | null = null;
    let predictionId: string | null = null;

    if (!replicate) {
      return {
        success: false,
        error: {
          ...appErrors.EXTERNAL_API_ERROR,
          message: "Replicate API client is not configured.",
        },
      };
    }
    if (!NEXT_PUBLIC_VERCEL_URL) {
      return {
        success: false,
        error: {
          ...appErrors.EXTERNAL_API_ERROR,
          message: "Deployment URL is not configured for Replicate webhook.",
        },
      };
    }

    try {
      // 1. Get Download Job details (video_id, storage_path)
      const { data: jobData, error: jobSelectError } =
        await supabaseServerClient
          .from("download_jobs")
          .select("video_id, storage_path")
          .eq("id", jobId)
          .eq("status", "completed") // Ensure the job is actually completed
          .single();

      if (jobSelectError || !jobData) {
        console.error(
          `Error fetching completed download job ${jobId}:`,
          jobSelectError
        );
        return {
          success: false,
          error: {
            ...appErrors.NOT_FOUND,
            message: `Completed download job ${jobId} not found.`,
          },
        };
      }

      if (!jobData.storage_path) {
        return {
          success: false,
          error: {
            ...appErrors.NOT_FOUND,
            message: `Storage path missing for job ${jobId}.`,
          },
        };
      }

      // storage_path is like "youtube-audio/<job_id>.m4a"
      const bucketAndPath = jobData.storage_path.split("/");
      if (bucketAndPath.length < 2) {
        return {
          success: false,
          error: {
            ...appErrors.UNEXPECTED_ERROR,
            message: `Invalid storage path format: ${jobData.storage_path}`,
          },
        };
      }
      const bucketName = bucketAndPath[0];
      const filePath = bucketAndPath.slice(1).join("/");

      // 2. Create temporary signed URL for the audio file
      const expiresIn = 60 * 5; // URL valid for 5 minutes
      const { data: signedUrlData, error: signedUrlError } =
        await supabaseServerClient.storage
          .from(bucketName)
          .createSignedUrl(filePath, expiresIn);

      if (signedUrlError || !signedUrlData) {
        console.error(
          `Error creating signed URL for ${jobData.storage_path}:`,
          signedUrlError
        );
        return {
          success: false,
          error: {
            ...appErrors.SUPABASE_STORAGE_ERROR,
            details: signedUrlError?.message || "Failed to create signed URL.",
          },
        };
      }
      const audioFileUrl = signedUrlData.signedUrl;
      // console.log(`Generated signed URL for Replicate: ${audioFileUrl}`); // Sensitive URL - Avoid logging in production

      // 3. Create initial Transcription record
      const { data: newTranscription, error: transcriptionInsertError } =
        await supabaseServerClient
          .from("transcriptions")
          .insert({
            video_id: jobData.video_id,
            job_id: jobId,
            status: "pending",
          })
          .select("id")
          .single();

      if (transcriptionInsertError || !newTranscription) {
        console.error(
          "Error creating transcription record:",
          transcriptionInsertError
        );
        return {
          success: false,
          error: {
            ...appErrors.DATABASE_ERROR,
            details:
              transcriptionInsertError?.message ||
              "Failed to insert transcription record.",
          },
        };
      }
      transcriptionRecordId = newTranscription.id;
      console.log(`Created transcription record: ${transcriptionRecordId}`);

      // 4. Call Replicate API
      const webhookUrl = new URL(
        `/api/webhooks/replicate`,
        `https://${NEXT_PUBLIC_VERCEL_URL}`
      );
      webhookUrl.searchParams.set("transcriptionId", transcriptionRecordId); // Pass ID for webhook handler
      if (REPLICATE_WEBHOOK_SECRET) {
        webhookUrl.searchParams.set("secret", REPLICATE_WEBHOOK_SECRET); // Simple secret validation
      }

      console.log(
        `Starting Replicate prediction for transcription ${transcriptionRecordId}...`
      );
      const prediction = await replicate.predictions.create({
        version:
          "d8bc5908738ebd84a9bb7d77d94b9c5e5a3d867886791d7171ddb60455b4c6af", // thomasmol/whisper-diarization
        input: {
          file_url: audioFileUrl, // Use signed URL
          // file: // Could also upload file directly, but URL is often easier
          num_speakers: numSpeakers, // Optional
          prompt: prompt, // Optional
          language: "en", // Specify source language if known, otherwise Replicate detects
          translate: false, // We handle translation separately if needed
          // Other params: word_timestamps, diarise etc. Defaults seem okay.
        },
        webhook: webhookUrl.toString(),
        webhook_events_filter: ["completed", "failed"], // Only notify on completion or failure
      });

      if (!prediction || !prediction.id) {
        console.error("Failed to create Replicate prediction:", prediction);
        // Update transcription status to failed
        await supabaseServerClient
          .from("transcriptions")
          .update({
            status: "failed",
            error_message: "Failed to initiate Replicate prediction.",
          })
          .eq("id", transcriptionRecordId);
        return {
          success: false,
          error: {
            ...appErrors.REPLICATE_ERROR,
            message: "Failed to initiate Replicate prediction.",
          },
        };
      }

      predictionId = prediction.id;
      console.log(`Replicate prediction started: ${predictionId}`);

      // 5. Update Transcription record with prediction ID and status
      const { error: transcriptionUpdateError } = await supabaseServerClient
        .from("transcriptions")
        .update({
          replicate_prediction_id: predictionId,
          status: "processing",
          updated_at: "now()", // Use Supabase DB function
        })
        .eq("id", transcriptionRecordId);

      if (transcriptionUpdateError) {
        // Log error, but the prediction is already running. Webhook might still succeed.
        console.error(
          `Error updating transcription record ${transcriptionRecordId} with prediction ID ${predictionId}:`,
          transcriptionUpdateError
        );
        // Don't fail the whole action, just log it.
      }

      return {
        success: true,
        data: {
          transcriptionId: transcriptionRecordId,
          predictionId: predictionId,
        },
      };
    } catch (error) {
      console.error("Unexpected error in startTranscription:", error);
      // Update transcription status to failed if record was created
      if (transcriptionRecordId) {
        try {
          await supabaseServerClient
            .from("transcriptions")
            .update({
              status: "failed",
              error_message: `Unexpected error: ${String(error)}`,
            })
            .eq("id", transcriptionRecordId);
        } catch (updateError) {
          console.error(
            `Failed to update transcription ${transcriptionRecordId} to failed after unexpected error:`,
            updateError
          );
        }
      }
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      // Check if error is already an AppError before wrapping
      const appError = Object.values(appErrors).find(
        (ae) => ae.message === errorMessage
      );
      return {
        success: false,
        error: appError || {
          ...appErrors.UNEXPECTED_ERROR,
          details: errorMessage,
        },
      };
    }
  }
);

// Helper function specific to startVideoProcessing action (Renamed to avoid conflict)
function extractYouTubeIdForProcessing(url: string): string | null {
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname === "youtu.be") {
      // Extract video ID from path for youtu.be links
      const pathParts = urlObj.pathname.split("/").filter(Boolean);
      return pathParts.length > 0 ? pathParts[0] : null;
    }
    if (urlObj.hostname.includes("youtube.com")) {
      const videoId = urlObj.searchParams.get("v");
      if (videoId) return videoId;
      // Handle youtube.com/shorts/ format
      if (urlObj.pathname.includes("/shorts/")) {
        const pathParts = urlObj.pathname.split("/").filter(Boolean);
        return pathParts.length > 1 && pathParts[0] === "shorts"
          ? pathParts[1]
          : null;
      }
    }
    return null;
  } catch (error) {
    console.error("Error parsing YouTube URL:", error);
    return null;
  }
}

// Zod schema for input validation
const startVideoProcessingSchema = z.object({
  youtubeUrl: z.string().url({ message: "Invalid YouTube URL provided." }),
  userId: z.string().uuid().optional(), // Optional: if user is logged in
});

type StartVideoProcessingInput = z.infer<typeof startVideoProcessingSchema>;
type StartVideoProcessingOutput = {
  jobId: string;
  videoId: string;
  videoExists: boolean; // Indicate if video record already existed
};

export const startVideoProcessing = action(
  startVideoProcessingSchema,
  async (
    input: StartVideoProcessingInput
  ): Promise<ActionResponse<StartVideoProcessingOutput>> => {
    const { youtubeUrl, userId } = input;
    let youtubeVideoId: string | null = null; // Renamed for clarity
    let dbVideoId: string | null = null;
    let jobRecordId: string | null = null;
    let videoExists = false;

    try {
      // 1. Extract YouTube ID using the renamed local helper
      youtubeVideoId = extractYouTubeIdForProcessing(youtubeUrl);
      if (!youtubeVideoId) {
        return {
          success: false,
          error: {
            ...appErrors.VALIDATION_FAILED,
            message: "Could not extract YouTube video ID from URL.",
            details: { url: youtubeUrl },
          },
        };
      }
      console.log(`Extracted YouTube ID: ${youtubeVideoId}`);

      // 2. Check/Create Video Record in Supabase
      const { data: existingVideo, error: videoSelectError } =
        await supabaseServerClient
          .from("videos") // Use table name as string
          .select("id")
          .eq("youtube_id", youtubeVideoId)
          .maybeSingle();

      if (videoSelectError) {
        console.error("Error checking for existing video:", videoSelectError);
        return {
          success: false,
          error: {
            ...appErrors.DATABASE_ERROR,
            details: videoSelectError.message,
          },
        };
      }

      if (existingVideo) {
        dbVideoId = existingVideo.id;
        videoExists = true;
        console.log(`Video record found for ${youtubeVideoId}: ${dbVideoId}`);
      } else {
        // Video not found, create a new record
        // TODO: Fetch actual video details (title, duration, thumbnail) - Placeholder for now
        const newVideoData = {
          youtube_id: youtubeVideoId,
          title: `YouTube Video ${youtubeVideoId}`, // Placeholder
          description: "Video description", // Placeholder
          thumbnail_url: "", // Placeholder
          duration: 0, // Placeholder
          // created_at and updated_at have defaults
        };
        const { data: newVideo, error: videoInsertError } =
          await supabaseServerClient
            .from("videos") // Use table name as string
            .insert(newVideoData)
            .select("id")
            .single();

        if (videoInsertError || !newVideo) {
          console.error("Error creating video record:", videoInsertError);
          return {
            success: false,
            error: {
              ...appErrors.DATABASE_ERROR,
              details:
                videoInsertError?.message || "Failed to insert video record.",
            },
          };
        }
        dbVideoId = newVideo.id;
        console.log(
          `Created new video record for ${youtubeVideoId}: ${dbVideoId}`
        );
      }

      if (!dbVideoId) {
        return {
          success: false,
          error: {
            ...appErrors.UNEXPECTED_ERROR,
            message: "Failed to obtain database video ID.",
          },
        };
      }

      // 3. Create Download Job Record
      jobRecordId = uuidv4(); // Generate a new UUID for the job
      const newJobData = {
        id: jobRecordId,
        video_id: dbVideoId,
        user_id: userId || null, // Link to user if provided
        status: "pending" as const, // Initial status (use 'as const' for type narrowing)
        // storage_path and error_message will be set later
        // created_at and updated_at have defaults
      };

      const { error: jobInsertError } = await supabaseServerClient
        .from("download_jobs") // Use table name as string
        .insert([newJobData]); // Pass insert data as an array

      if (jobInsertError) {
        console.error("Error creating download job record:", jobInsertError);
        return {
          success: false,
          error: {
            ...appErrors.DATABASE_ERROR,
            details: jobInsertError.message,
          },
        };
      }
      console.log(`Created new download job record: ${jobRecordId}`);

      // 4. Call Download Service (Fire and Forget for now)
      try {
        const response = await fetch(DOWNLOAD_SERVICE_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            youtube_url: youtubeUrl,
            job_id: jobRecordId,
          }),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          console.error(
            `Error calling download service for job ${jobRecordId}: ${response.status} ${response.statusText}`,
            errorBody
          );
          // Update job status to failed immediately
          await supabaseServerClient
            .from("download_jobs")
            .update({
              status: "failed",
              error_message: `Download service call failed: ${response.status}`,
            })
            .eq("id", jobRecordId);
          return {
            success: false,
            error: {
              ...appErrors.DOWNLOAD_SERVICE_ERROR,
              message: `Download service returned status ${response.status}`,
              details: errorBody,
            },
          };
        }

        const responseData = await response.json();
        console.log(
          `Successfully called download service for job ${jobRecordId}. Response:`,
          responseData
        );
        // Download service will update job status later
      } catch (fetchError) {
        console.error(
          `Network error calling download service for job ${jobRecordId}:`,
          fetchError
        );
        // Update job status to failed
        await supabaseServerClient
          .from("download_jobs")
          .update({
            status: "failed",
            error_message: `Network error calling download service: ${String(
              fetchError
            )}`,
          })
          .eq("id", jobRecordId);
        const errorMessage =
          fetchError instanceof Error ? fetchError.message : String(fetchError);
        return {
          success: false,
          error: {
            ...appErrors.DOWNLOAD_SERVICE_ERROR,
            message: "Network error calling download service.",
            details: errorMessage,
          },
        };
      }

      // 5. Return Success Response
      return {
        success: true,
        data: {
          jobId: jobRecordId,
          videoId: dbVideoId,
          videoExists: videoExists,
        },
      };
    } catch (error) {
      console.error("Unexpected error in startVideoProcessing:", error);
      // Ensure job status reflects failure if job was created
      if (jobRecordId) {
        try {
          await supabaseServerClient
            .from("download_jobs")
            .update({
              status: "failed",
              error_message: "Unexpected server action error.",
            })
            .eq("id", jobRecordId);
        } catch (updateError) {
          console.error(
            `Failed to update job ${jobRecordId} to failed after unexpected error:`,
            updateError
          );
        }
      }
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: { ...appErrors.UNEXPECTED_ERROR, details: errorMessage },
      };
    }
  }
);
