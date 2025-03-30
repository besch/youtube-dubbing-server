"use server";

import { createSafeActionClient } from "next-safe-action";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import Replicate from "replicate";

import type { ActionResponse } from "@/types/actions";
import { appErrors, AppErrorCode } from "@/types/actions";
import { supabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/supabase";

const action = createSafeActionClient();

// Environment variables
const DOWNLOAD_SERVICE_URL =
  process.env.DOWNLOAD_SERVICE_URL || "http://83.27.167.60:1777/process"; // Make it configurable

// Helper function to extract YouTube ID (simple version)
function extractYouTubeId(url: string): string | null {
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

export const startVideoProcessing = action
  .schema(startVideoProcessingSchema)
  .action(
    async ({
      parsedInput,
    }): Promise<ActionResponse<StartVideoProcessingOutput>> => {
      const { youtubeUrl, userId } = parsedInput;
      let youtubeVideoId: string | null = null;
      let dbVideoId: string | null = null;
      let jobRecordId: string | null = null;
      let videoExists = false;

      try {
        // 1. Extract YouTube ID
        youtubeVideoId = extractYouTubeId(youtubeUrl);
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
          const newVideoData = {
            youtube_id: youtubeVideoId,
            title: `YouTube Video ${youtubeVideoId}`, // Placeholder
            description: "Video description", // Placeholder
            thumbnail_url: "", // Placeholder
            duration: 0, // Placeholder
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
          status: "pending" as const, // Initial status
        };

        const { error: jobInsertError } = await supabaseServerClient
          .from("download_jobs") // Use table name as string
          .insert(newJobData);

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

        // 4. Call Download Service
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
            fetchError instanceof Error
              ? fetchError.message
              : String(fetchError);
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

// Replicate Client
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// Webhook URL
const REPLICATE_WEBHOOK_URL =
  process.env.REPLICATE_WEBHOOK_URL ||
  `${
    process.env.NEXT_PUBLIC_VERCEL_URL || "http://localhost:3000"
  }/api/webhooks/replicate`;

// Zod schema for starting transcription
const startTranscriptionSchema = z.object({
  jobId: z.string().uuid(), // The ID of the completed download job
  numSpeakers: z.number().int().min(1).optional(),
  sourceLanguageHint: z.string().optional(),
  transcriptionPrompt: z.string().optional(),
});

type StartTranscriptionInput = z.infer<typeof startTranscriptionSchema>;
type StartTranscriptionOutput = {
  transcriptionRecordId: string;
  replicatePredictionId: string;
};

export const startTranscription = action
  .schema(startTranscriptionSchema)
  .action(
    async ({
      parsedInput,
    }): Promise<ActionResponse<StartTranscriptionOutput>> => {
      const { jobId, numSpeakers, sourceLanguageHint, transcriptionPrompt } =
        parsedInput;
      let transcriptionRecordId: string | null = null;

      try {
        // 1. Verify Download Job Status and Get Audio Path
        const { data: downloadJob, error: jobError } =
          await supabaseServerClient
            .from("download_jobs")
            .select("id, video_id, status, storage_path")
            .eq("id", jobId)
            .single();

        if (jobError || !downloadJob) {
          console.error(
            `Download job ${jobId} not found or error fetching:`,
            jobError
          );
          return {
            success: false,
            error: {
              ...appErrors.NOT_FOUND,
              message: `Download job ${jobId} not found.`,
            },
          };
        }

        // Use type assertion for status if needed, or rely on generated types
        const jobStatus = downloadJob.status as
          | Database["public"]["Enums"]["job_status"]
          | string;

        if (jobStatus !== "completed" || !downloadJob.storage_path) {
          console.warn(
            `Download job ${jobId} is not completed or missing storage path (status: ${jobStatus}).`
          );
          // Use specific AppErrorCode here
          return {
            success: false,
            error: {
              code: AppErrorCode.VALIDATION_FAILED,
              message: "Download job is not ready for transcription.",
            },
          };
        }

        const videoId = downloadJob.video_id;
        const audioStoragePath = downloadJob.storage_path;

        // 2. Check if transcription already exists or is in progress
        const { data: existingTranscription, error: transSelectError } =
          await supabaseServerClient
            .from("transcriptions")
            .select("id, status, replicate_prediction_id")
            .eq("video_id", videoId)
            .maybeSingle();

        if (transSelectError) {
          console.error(
            `Error checking for existing transcription for video ${videoId}:`,
            transSelectError
          );
          return {
            success: false,
            error: {
              ...appErrors.DATABASE_ERROR,
              details: transSelectError.message,
            },
          };
        }

        if (existingTranscription) {
          const existingStatus = existingTranscription.status as
            | Database["public"]["Enums"]["job_status"]
            | string;
          if (
            existingStatus === "completed" ||
            (existingStatus === "processing" &&
              existingTranscription.replicate_prediction_id)
          ) {
            console.log(
              `Transcription for video ${videoId} already exists or is processing (status: ${existingStatus}).`
            );
            return {
              success: true,
              data: {
                transcriptionRecordId: existingTranscription.id,
                replicatePredictionId:
                  existingTranscription.replicate_prediction_id || "N/A",
              },
            };
          } else {
            transcriptionRecordId = existingTranscription.id;
            console.log(
              `Reusing existing transcription record ${transcriptionRecordId} for video ${videoId}.`
            );
          }
        }

        // 3. Get Signed URL for the Audio File
        // Extract bucket name and file path from storage_path
        const bucketAndPath = audioStoragePath.split("/");
        if (bucketAndPath.length < 2) {
          console.error(`Invalid storage path format: ${audioStoragePath}`);
          return {
            success: false,
            error: {
              ...appErrors.UNEXPECTED_ERROR,
              message: "Invalid audio storage path format.",
            },
          };
        }
        const bucketName = bucketAndPath[0];
        const filePath = bucketAndPath.slice(1).join("/");

        const { data: signedUrlData, error: urlError } =
          await supabaseServerClient.storage
            .from(bucketName)
            .createSignedUrl(filePath, 60 * 5); // 5 minutes validity

        if (urlError || !signedUrlData?.signedUrl) {
          console.error(
            `Error creating signed URL for ${filePath} in bucket ${bucketName}:`,
            urlError
          );
          if (transcriptionRecordId) {
            await supabaseServerClient
              .from("transcriptions")
              .update({
                status: "failed",
                error_message: "Failed to get audio URL for Replicate",
              })
              .eq("id", transcriptionRecordId);
          }
          return {
            success: false,
            error: {
              ...appErrors.SUPABASE_STORAGE_ERROR,
              details: urlError?.message || "Failed to create signed URL.",
            },
          };
        }

        const audioFileUrl = signedUrlData.signedUrl;
        console.log(
          `Generated temporary signed URL for Replicate: ${audioFileUrl}`
        );

        // 4. Create or Update Transcription Record
        let predictionId: string | null = null;

        if (!transcriptionRecordId) {
          // Create new record
          const { data: newTranscription, error: transInsertError } =
            await supabaseServerClient
              .from("transcriptions")
              .insert({
                video_id: videoId,
                job_id: jobId,
                status: "processing" as const,
              })
              .select("id")
              .single();

          if (transInsertError || !newTranscription) {
            console.error(
              `Error creating transcription record for video ${videoId}:`,
              transInsertError
            );
            return {
              success: false,
              error: {
                ...appErrors.DATABASE_ERROR,
                details:
                  transInsertError?.message ||
                  "Failed to create transcription record.",
              },
            };
          }
          transcriptionRecordId = newTranscription.id;
          console.log(
            `Created new transcription record ${transcriptionRecordId} for video ${videoId}.`
          );
        } else {
          // Update existing record
          const { error: transUpdateError } = await supabaseServerClient
            .from("transcriptions")
            .update({
              status: "processing" as const,
              error_message: null,
              replicate_prediction_id: null,
            })
            .eq("id", transcriptionRecordId);

          if (transUpdateError) {
            console.error(
              `Error updating transcription record ${transcriptionRecordId} status:`,
              transUpdateError
            );
          }
        }

        // 5. Start Replicate Prediction
        try {
          const prediction = await replicate.predictions.create({
            version:
              "d8bc5908738ebd84a9bb7d77d94b9c5e5a3d867886791d7171ddb60455b4c6af", // thomasmol/whisper-diarization
            input: {
              file_url: audioFileUrl,
              num_speakers: numSpeakers || undefined,
              language: sourceLanguageHint || undefined,
              prompt: transcriptionPrompt || undefined,
              webhook_events_filter: ["completed"],
            },
            webhook: `${REPLICATE_WEBHOOK_URL}?transcription_id=${transcriptionRecordId}`, // Pass ID
          });

          predictionId = prediction.id;
          console.log(
            `Started Replicate prediction ${predictionId} for transcription ${transcriptionRecordId}.`
          );

          // 6. Update Transcription Record with Prediction ID
          const { error: predictionIdUpdateError } = await supabaseServerClient
            .from("transcriptions")
            .update({
              replicate_prediction_id: predictionId,
              status: "processing" as const,
            })
            .eq("id", transcriptionRecordId);

          if (predictionIdUpdateError) {
            console.error(
              `Failed to update transcription record ${transcriptionRecordId} with prediction ID ${predictionId}:`,
              predictionIdUpdateError
            );
          }

          return {
            success: true,
            data: {
              transcriptionRecordId: transcriptionRecordId,
              replicatePredictionId: predictionId,
            },
          };
        } catch (replicateError) {
          console.error(
            `Error starting Replicate prediction for transcription ${transcriptionRecordId}:`,
            replicateError
          );
          await supabaseServerClient
            .from("transcriptions")
            .update({
              status: "failed",
              error_message: `Replicate API error: ${String(replicateError)}`,
            })
            .eq("id", transcriptionRecordId);
          const errorMessage =
            replicateError instanceof Error
              ? replicateError.message
              : String(replicateError);
          return {
            success: false,
            error: { ...appErrors.REPLICATE_ERROR, details: errorMessage },
          };
        }
      } catch (error) {
        console.error("Unexpected error in startTranscription:", error);
        if (transcriptionRecordId) {
          try {
            await supabaseServerClient
              .from("transcriptions")
              .update({
                status: "failed",
                error_message: "Unexpected server action error.",
              })
              .eq("id", transcriptionRecordId);
          } catch (updateError) {
            console.error(
              "Secondary error updating transcription status:",
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
