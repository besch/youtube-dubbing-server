"use server";

import { createSafeActionClient } from "next-safe-action";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import Replicate from "replicate";

import type { ActionResponse } from "@/types/actions";
import { appErrors, AppErrorCode } from "@/types/actions";
import { supabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/supabase";
import { openai, translateTextOpenAI } from "@/lib/openai";

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

// --- Types for Replicate Output ---
interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

// --- generateAudioChunk Action --- //

type OpenAiTtsVoice = "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";
// Use a tuple for Zod enum
const OPENAI_TTS_VOICES: [OpenAiTtsVoice, ...OpenAiTtsVoice[]] = [
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
];

const generateAudioChunkSchema = z.object({
  videoId: z.string().uuid(),
  language: z.string(),
  voice: z.enum(OPENAI_TTS_VOICES), // Use the tuple here
  // Fix Zod enum usage in record value
  speakerVoiceMap: z.record(z.enum(OPENAI_TTS_VOICES)).optional(),
  startTime: z.number().min(0),
  endTime: z.number().min(0),
  originalLanguage: z.string().optional().default("en"),
});

type GenerateAudioChunkInput = z.infer<typeof generateAudioChunkSchema>;
type GenerateAudioChunkOutput = {
  storagePath: string;
  publicUrl: string;
  startTime: number;
  endTime: number;
};

export const generateAudioChunk = action
  .schema(generateAudioChunkSchema)
  .action(
    async ({
      parsedInput,
    }): Promise<ActionResponse<GenerateAudioChunkOutput>> => {
      const {
        videoId,
        language,
        voice,
        speakerVoiceMap,
        startTime,
        endTime,
        originalLanguage,
      } = parsedInput;

      try {
        // 1. Fetch Completed Transcription Content
        const { data: transcription, error: transcriptionError } =
          await supabaseServerClient
            .from("transcriptions")
            .select("content, is_favorite")
            .eq("video_id", videoId)
            .eq("status", "completed")
            .single();

        if (transcriptionError || !transcription?.content) {
          console.error(
            `Completed transcription not found or content missing for video ${videoId}:`,
            transcriptionError
          );
          return {
            success: false,
            error: {
              ...appErrors.NOT_FOUND,
              message: "Completed transcription not found.",
            },
          };
        }

        // Use safer type assertion for JSON content
        const allSegments =
          transcription.content as unknown as TranscriptionSegment[];
        const isVideoFavorite = transcription.is_favorite ?? false;

        // 2. Filter Relevant Segments
        const relevantSegments = allSegments.filter(
          (segment) => segment.end > startTime && segment.start < endTime
        );

        if (relevantSegments.length === 0) {
          console.log(
            `No transcription segments found between ${startTime}s and ${endTime}s for video ${videoId}.`
          );
          return {
            success: false,
            error: {
              code: AppErrorCode.NOT_FOUND,
              message: "No text content found for the requested time range.",
            },
          };
        }

        // 3. Combine Text and Handle Translation
        const combinedText = relevantSegments
          .map((seg) => seg.text)
          .join(" ")
          .trim();

        if (!combinedText) {
          console.log(
            `Combined text is empty for range ${startTime}-${endTime} in video ${videoId}.`
          );
          return {
            success: false,
            error: {
              code: AppErrorCode.NOT_FOUND,
              message: "No text content found for the requested time range.",
            },
          };
        }

        let textToSpeak = combinedText;
        if (language !== originalLanguage) {
          const translated = await translateTextOpenAI(
            combinedText,
            originalLanguage,
            language
          );
          if (translated === null) {
            return {
              success: false,
              error: {
                ...appErrors.OPENAI_ERROR,
                message: "Translation failed.",
              },
            };
          }
          textToSpeak = translated;
        }

        // 4. Generate TTS using OpenAI
        const chosenVoice: OpenAiTtsVoice = voice;

        if (!openai.apiKey) {
          return {
            success: false,
            error: {
              ...appErrors.OPENAI_ERROR,
              message: "OpenAI API key not configured.",
            },
          };
        }

        let audioBuffer: Buffer;
        try {
          const mp3 = await openai.audio.speech.create({
            model: "tts-1",
            voice: chosenVoice,
            input: textToSpeak,
            response_format: "mp3",
          });
          audioBuffer = Buffer.from(await mp3.arrayBuffer());
        } catch (ttsError) {
          console.error(
            `OpenAI TTS generation failed for video ${videoId} range ${startTime}-${endTime}:`,
            ttsError
          );
          const errorMessage =
            ttsError instanceof Error ? ttsError.message : String(ttsError);
          return {
            success: false,
            error: { ...appErrors.OPENAI_ERROR, details: errorMessage },
          };
        }

        // 5. Upload Audio Chunk to Supabase Storage
        const storageBucket = "translated-audio";
        const storageFileName = `${videoId}/${language}/${chosenVoice}/${startTime.toFixed(
          2
        )}_${endTime.toFixed(2)}.mp3`;

        try {
          const { error: uploadError } = await supabaseServerClient.storage
            .from(storageBucket)
            .upload(storageFileName, audioBuffer, {
              contentType: "audio/mpeg",
              upsert: true,
            });

          if (uploadError) {
            throw uploadError;
          }
          console.log(
            `Uploaded audio chunk to ${storageBucket}/${storageFileName}`
          );
        } catch (storageError) {
          console.error(
            `Failed to upload audio chunk ${storageFileName} to Supabase Storage:`,
            storageError
          );
          const errorMessage =
            storageError instanceof Error
              ? storageError.message
              : String(storageError);
          return {
            success: false,
            error: {
              ...appErrors.SUPABASE_STORAGE_ERROR,
              details: errorMessage,
            },
          };
        }

        // 6. Create Record in translated_audio_chunks Table
        const chunkData = {
          video_id: videoId,
          language: language,
          voice: chosenVoice, // This assignment is type-safe
          chunk_start: startTime,
          chunk_end: endTime,
          storage_path: `${storageBucket}/${storageFileName}`,
          is_favorite: isVideoFavorite,
          expiry_at: isVideoFavorite
            ? null
            : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        };

        const { error: dbInsertError } = await supabaseServerClient
          .from("translated_audio_chunks")
          .upsert(chunkData, {
            onConflict: "video_id, language, voice, chunk_start, chunk_end",
          });

        if (dbInsertError) {
          console.error(
            `Error saving translated audio chunk record for video ${videoId}:`,
            dbInsertError
          );
          return {
            success: false,
            error: {
              ...appErrors.DATABASE_ERROR,
              details: dbInsertError.message,
            },
          };
        }

        // 7. Get Public URL
        const { data: urlData } = supabaseServerClient.storage
          .from(storageBucket)
          .getPublicUrl(storageFileName);

        console.log(
          `Generated audio chunk for video ${videoId}, range ${startTime}-${endTime}, lang ${language}, voice ${chosenVoice}.`
        );

        return {
          success: true,
          data: {
            storagePath: `${storageBucket}/${storageFileName}`,
            publicUrl: urlData?.publicUrl || "",
            startTime: startTime,
            endTime: endTime,
          },
        };
      } catch (error) {
        console.error("Unexpected error in generateAudioChunk:", error);
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: { ...appErrors.UNEXPECTED_ERROR, details: errorMessage },
        };
      }
    }
  );
