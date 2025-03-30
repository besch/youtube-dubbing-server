"use server";

// Remove unused import
// import { createSafeActionClient } from "next-safe-action";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import OpenAI from "openai"; // Import OpenAI class
import { Buffer } from "buffer"; // Import Buffer if not already globally available
// Remove unused Replicate import if client isn't used yet
// import Replicate from "replicate";
import type { User } from "@supabase/supabase-js"; // Re-import User type for assertion

// Remove unused Database type import
// import type { Database } from "@/types/supabase";
import { protectedAction } from "./safe-action";
import { supabaseServiceRoleClient } from "@/lib/supabase/serviceRoleClient";
import { ActionResponse, AppError, AppErrorCode, appErrors } from "./actions";

// Comment out unused OpenAI client for now
// import { openai, translateTextOpenAI } from "@/lib/openai";

// Comment out unused variable
// const DOWNLOAD_SERVICE_URL =
//   process.env.DOWNLOADER_SERVICE_URL || "http://83.27.167.60:1777/process";

// Remove unused action variable
// const action = createSafeActionClient();

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
        throw error;
      }
    }
  );

// Replicate Client
// const replicate = new Replicate({
//   auth: process.env.REPLICATE_API_TOKEN,
// });

// Webhook URL
// const REPLICATE_WEBHOOK_URL =
//   process.env.REPLICATE_WEBHOOK_URL ||
//   `${
//     process.env.NEXT_PUBLIC_VERCEL_URL || "http://localhost:3000"
//   }/api/webhooks/replicate`;

// Zod schema for starting transcription
// const startTranscriptionSchema = z.object({
//   jobId: z.string().uuid(), // The ID of the completed download job
//   numSpeakers: z.number().int().min(1).optional(),
//   sourceLanguageHint: z.string().optional(),
//   transcriptionPrompt: z.string().optional(),
// });

// type StartTranscriptionInput = z.infer<typeof startTranscriptionSchema>;
// type StartTranscriptionOutput = {
//   transcriptionRecordId: string;
//   replicatePredictionId: string;
// };

// export const startTranscription = action
//   .schema(startTranscriptionSchema)
//   .action(
//     async ({
//       parsedInput,
//     }): Promise<ActionResponse<StartTranscriptionOutput>> => {
//       const { jobId, numSpeakers, sourceLanguageHint, transcriptionPrompt } =
//         parsedInput;
//       let transcriptionRecordId: string | null = null;

//       try {
//         // 1. Verify Download Job Status and Get Audio Path
//         const { data: downloadJob, error: jobError } =
//           await supabaseServiceRoleClient // Use service role client
//             .from("download_jobs")
//             .select("id, video_id, status, storage_path")
//             .eq("id", jobId)
//             .single();

//         if (jobError || !downloadJob) {
//           console.error(
//             `Download job ${jobId} not found or error fetching:`,
//             jobError
//           );
//           return {
//             success: false,
//             error: new AppError(
//               AppErrorCode.RECORD_NOT_FOUND,
//               `Download job ${jobId} not found.`
//             ),
//           };
//         }

//         const jobStatus = downloadJob.status;

//         if (jobStatus !== "completed" || !downloadJob.storage_path) {
//           console.warn(
//             `Download job ${jobId} is not completed or missing storage path (status: ${jobStatus}).`
//           );
//           return {
//             success: false,
//             error: new AppError(
//               AppErrorCode.INVALID_INPUT,
//               "Download job is not ready for transcription."
//             ),
//           };
//         }

//         const videoId = downloadJob.video_id;
//         const audioStoragePath = downloadJob.storage_path;

//         // 2. Check if transcription already exists or is in progress
//         const { data: existingTranscription, error: transSelectError } =
//           await supabaseServiceRoleClient
//             .from("transcriptions")
//             .select("id, status, replicate_prediction_id")
//             .eq("video_id", videoId)
//             .maybeSingle();

//         if (transSelectError) {
//           console.error(
//             `Error checking for existing transcription for video ${videoId}:`,
//             transSelectError
//           );
//           throw new AppError(
//             AppErrorCode.DATABASE_ERROR,
//             transSelectError.message
//           );
//         }

//         if (existingTranscription) {
//           const existingStatus = existingTranscription.status;
//           if (
//             existingStatus === "completed" ||
//             (existingStatus === "processing" &&
//               existingTranscription.replicate_prediction_id)
//           ) {
//             console.log(
//               `Transcription for video ${videoId} already exists or is processing (status: ${existingStatus}).`
//             );
//             return {
//               success: true,
//               data: {
//                 transcriptionRecordId: existingTranscription.id,
//                 replicatePredictionId:
//                   existingTranscription.replicate_prediction_id || "N/A",
//               },
//             };
//           } else {
//             transcriptionRecordId = existingTranscription.id;
//             console.log(
//               `Reusing existing transcription record ${transcriptionRecordId} for video ${videoId}.`
//             );
//           }
//         }

//         // 3. Get Signed URL for the Audio File
//         const bucketAndPath = audioStoragePath.split("/");
//         if (bucketAndPath.length < 1) {
//           // Check if path exists
//           console.error(`Invalid storage path format: ${audioStoragePath}`);
//           throw new AppError(
//             AppErrorCode.UNEXPECTED_ERROR,
//             "Invalid audio storage path format."
//           );
//         }
//         // Assuming path is just the filename in the bucket
//         const bucketName = "youtube-audio"; // Hardcoded for now, should match downloader
//         const filePath = audioStoragePath;

//         const { data: signedUrlData, error: urlError } =
//           await supabaseServiceRoleClient.storage
//             .from(bucketName)
//             .createSignedUrl(filePath, 60 * 5); // 5 minutes validity

//         if (urlError || !signedUrlData?.signedUrl) {
//           console.error(
//             `Error creating signed URL for ${filePath} in bucket ${bucketName}:`,
//             urlError
//           );
//           if (transcriptionRecordId) {
//             await supabaseServiceRoleClient
//               .from("transcriptions")
//               .update({
//                 status: "failed",
//                 error_message: "Failed to get audio URL for Replicate",
//               })
//               .eq("id", transcriptionRecordId);
//           }
//           throw new AppError(
//             AppErrorCode.SUPABASE_STORAGE_ERROR,
//             urlError?.message || "Failed to create signed URL."
//           );
//         }

//         const audioFileUrl = signedUrlData.signedUrl;
//         console.log(
//           `Generated temporary signed URL for Replicate: ${audioFileUrl}`
//         );

//         // 4. Create or Update Transcription Record
//         let predictionId: string | null = null;

//         if (!transcriptionRecordId) {
//           // Create new record
//           const { data: newTranscription, error: transInsertError } =
//             await supabaseServiceRoleClient
//               .from("transcriptions")
//               .insert({
//                 video_id: videoId,
//                 job_id: jobId,
//                 status: "processing" as const,
//               })
//               .select("id")
//               .single();

//           if (transInsertError || !newTranscription) {
//             console.error(
//               `Error creating transcription record for video ${videoId}:`,
//               transInsertError
//             );
//             throw new AppError(
//               AppErrorCode.DATABASE_ERROR,
//               transInsertError?.message ||
//                 "Failed to create transcription record."
//             );
//           }
//           transcriptionRecordId = newTranscription.id;
//           console.log(
//             `Created new transcription record ${transcriptionRecordId} for video ${videoId}.`
//           );
//         } else {
//           // Update existing record to processing status again
//           const { error: transUpdateError } = await supabaseServiceRoleClient
//             .from("transcriptions")
//             .update({
//               status: "processing" as const,
//               error_message: null,
//               replicate_prediction_id: null,
//             })
//             .eq("id", transcriptionRecordId);

//           if (transUpdateError) {
//             console.warn(
//               `Error updating transcription record ${transcriptionRecordId} status:`,
//               transUpdateError
//             );
//             // Log warning but continue
//           }
//         }

//         // 5. Start Replicate Prediction
//         try {
//           if (!process.env.REPLICATE_API_KEY) {
//             throw new AppError(
//               AppErrorCode.REPLICATE_API_ERROR,
//               "Replicate API key not configured."
//             );
//           }
//           const replicateClient = new Replicate({
//             auth: process.env.REPLICATE_API_KEY,
//           });
//           const prediction = await replicateClient.predictions.create({
//             version:
//               "d8bc5908738ebd84a9bb7d77d94b9c5e5a3d867886791d7171ddb60455b4c6af", // thomasmol/whisper-diarization
//             input: {
//               file_url: audioFileUrl,
//               num_speakers: numSpeakers || undefined,
//               language: sourceLanguageHint || undefined,
//               prompt: transcriptionPrompt || undefined,
//               webhook_events_filter: ["completed"],
//             },
//             webhook: `${REPLICATE_WEBHOOK_URL}?transcription_id=${transcriptionRecordId}`, // Pass ID
//           });

//           predictionId = prediction.id;
//           console.log(
//             `Started Replicate prediction ${predictionId} for transcription ${transcriptionRecordId}.`
//           );

//           // 6. Update Transcription Record with Prediction ID
//           const { error: predictionIdUpdateError } =
//             await supabaseServiceRoleClient
//               .from("transcriptions")
//               .update({
//                 replicate_prediction_id: predictionId,
//                 status: "processing" as const,
//               })
//               .eq("id", transcriptionRecordId);

//           if (predictionIdUpdateError) {
//             console.error(
//               `Failed to update transcription record ${transcriptionRecordId} with prediction ID ${predictionId}:`,
//               predictionIdUpdateError
//             );
//             // Log error but don't necessarily fail the action here
//           }

//           return {
//             success: true,
//             data: {
//               transcriptionRecordId: transcriptionRecordId,
//               replicatePredictionId: predictionId,
//             },
//           };
//         } catch (replicateError) {
//           console.error(
//             `Error starting Replicate prediction for transcription ${transcriptionRecordId}:`,
//             replicateError
//           );
//           await supabaseServiceRoleClient
//             .from("transcriptions")
//             .update({
//               status: "failed",
//               error_message: `Replicate API error: ${String(replicateError)}`,
//             })
//             .eq("id", transcriptionRecordId);

//           throw new AppError(
//             AppErrorCode.REPLICATE_API_ERROR,
//             String(replicateError)
//           );
//         }
//       } catch (error) {
//         console.error("Unexpected error in startTranscription:", error);
//         if (transcriptionRecordId) {
//           try {
//             await supabaseServiceRoleClient
//               .from("transcriptions")
//               .update({
//                 status: "failed",
//                 error_message: "Unexpected server action error.",
//               })
//               .eq("id", transcriptionRecordId);
//           } catch (updateError) {
//             console.error(
//               "Secondary error updating transcription status:",
//               updateError
//             );
//           }
//         }
//         // Throw the error for the safe action client to handle
//         throw error;
//       }
//     }
//   );

// --- Types for Replicate Output ---
interface TranscriptionWord {
  start: number;
  end: number;
  word: string;
  speaker?: string;
  probability?: number;
}
export interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
  words?: TranscriptionWord[];
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
  voice: z.enum(OPENAI_TTS_VOICES), // Default voice for segments without specific speaker mapping
  speakerVoiceMap: z.record(z.enum(OPENAI_TTS_VOICES)).optional(), // Map speaker ID (e.g., SPEAKER_00) to voice
  startTime: z.number().min(0),
  endTime: z.number().min(0),
  // originalLanguage: z.string().optional().default("en"), // Translation handled separately if needed
});

type GenerateAudioChunkOutput = {
  storagePath: string;
  publicUrl: string;
  startTime: number; // Echo back start time
  endTime: number; // Echo back end time
};

export const generateAudioChunk = protectedAction // Should use protectedAction
  .schema(generateAudioChunkSchema)
  .action(
    async ({
      parsedInput,
    }): Promise<ActionResponse<GenerateAudioChunkOutput>> => {
      const {
        videoId,
        language,
        voice,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        speakerVoiceMap: _speakerVoiceMap, // Ensure disable comment is here
        startTime,
        endTime,
      } = parsedInput;

      try {
        // 1. Fetch Completed Transcription Content
        const { data: transcription, error: transcriptionError } =
          await supabaseServiceRoleClient // Use service role client
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
            error: new AppError(
              AppErrorCode.RECORD_NOT_FOUND,
              "Completed transcription not found."
            ),
          };
        }

        // Use safer type assertion for JSON content
        const allSegments =
          transcription.content as unknown as TranscriptionSegment[];
        const isVideoFavorite = transcription.is_favorite ?? false;

        // 2. Filter Relevant Segments for the requested time range
        const relevantSegments = allSegments.filter(
          (segment) => segment.end > startTime && segment.start < endTime
        );

        if (relevantSegments.length === 0) {
          console.log(
            `No transcription segments found between ${startTime}s and ${endTime}s for video ${videoId}.`
          );
          return {
            success: false,
            error: new AppError(
              AppErrorCode.RECORD_NOT_FOUND,
              "No text content found for the requested time range."
            ),
          };
        }

        // 3. Combine Text (Translation logic removed - assume text is already in target language or handle upstream)
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
            error: new AppError(
              AppErrorCode.INVALID_INPUT,
              "Combined text content is empty."
            ),
          };
        }

        // TODO: Handle speaker-specific voice generation if speakerVoiceMap is provided
        // For now, use the single provided `voice`
        const chosenVoice: OpenAiTtsVoice = voice;
        const textToSpeak = combinedText;

        // 4. Check if chunk already exists in DB/Storage
        const uniqueChunkId = `${videoId}_${language}_${chosenVoice}_${startTime.toFixed(
          2
        )}_${endTime.toFixed(2)}`;
        const storageBucket = "translated-audio";
        const storageFileName = `${videoId}/${language}/${chosenVoice}/${startTime.toFixed(
          2
        )}_${endTime.toFixed(2)}.mp3`;
        const fullStoragePath = `${storageBucket}/${storageFileName}`;

        const { data: existingChunk, error: chunkCheckError } =
          await supabaseServiceRoleClient
            .from("translated_audio_chunks")
            .select("storage_path")
            .eq("video_id", videoId)
            .eq("language", language)
            .eq("voice", chosenVoice)
            .eq("chunk_start", startTime)
            .eq("chunk_end", endTime)
            .maybeSingle();

        if (chunkCheckError) {
          console.error(
            `Error checking for existing audio chunk ${uniqueChunkId}:`,
            chunkCheckError
          );
          // Log error but proceed with generation
        }

        if (existingChunk) {
          console.log(
            `Audio chunk ${uniqueChunkId} already exists. Returning existing.`
          );
          // Get public URL for existing chunk
          const { data: urlData } = supabaseServiceRoleClient.storage
            .from(storageBucket)
            .getPublicUrl(storageFileName);
          return {
            success: true,
            data: {
              storagePath: fullStoragePath,
              publicUrl: urlData?.publicUrl || "",
              startTime: startTime,
              endTime: endTime,
            },
          };
        }

        // 5. Generate TTS using OpenAI
        if (!process.env.OPENAI_API_KEY) {
          throw new AppError(
            AppErrorCode.OPENAI_API_ERROR,
            "OpenAI API key not configured."
          );
        }
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        let audioBuffer: Buffer;
        try {
          console.log(
            `Generating TTS for chunk ${uniqueChunkId} with voice ${chosenVoice}`
          );
          const mp3 = await openai.audio.speech.create({
            model: "tts-1",
            voice: chosenVoice,
            input: textToSpeak,
            response_format: "mp3",
          });
          audioBuffer = Buffer.from(await mp3.arrayBuffer());
        } catch (ttsError) {
          console.error(
            `OpenAI TTS generation failed for chunk ${uniqueChunkId}:`,
            ttsError
          );
          throw new AppError(AppErrorCode.OPENAI_API_ERROR, String(ttsError));
        }

        // 6. Upload Audio Chunk to Supabase Storage
        try {
          console.log(
            `Uploading audio chunk ${storageFileName} to bucket ${storageBucket}`
          );
          const { error: uploadError } = await supabaseServiceRoleClient.storage
            .from(storageBucket)
            .upload(storageFileName, audioBuffer, {
              contentType: "audio/mpeg",
              upsert: true, // Allow overwriting if it failed previously
            });

          if (uploadError) {
            throw uploadError;
          }
          console.log(`Uploaded audio chunk to ${fullStoragePath}`);
        } catch (storageError) {
          console.error(
            `Failed to upload audio chunk ${storageFileName} to Supabase Storage:`,
            storageError
          );
          throw new AppError(
            AppErrorCode.SUPABASE_STORAGE_ERROR,
            String(storageError)
          );
        }

        // 7. Create Record in translated_audio_chunks Table
        const chunkData = {
          video_id: videoId,
          language: language,
          voice: chosenVoice,
          chunk_start: startTime,
          chunk_end: endTime,
          storage_path: storageFileName, // Store only the path within the bucket
          is_favorite: isVideoFavorite,
          expiry_at: isVideoFavorite
            ? null
            : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7-day expiry for non-favorites
        };

        const { error: dbInsertError } = await supabaseServiceRoleClient
          .from("translated_audio_chunks")
          .upsert(chunkData, {
            onConflict: "video_id, language, voice, chunk_start, chunk_end", // Ensure correct constraint name
          });

        if (dbInsertError) {
          console.error(
            `Error saving translated audio chunk record for ${uniqueChunkId}:`,
            dbInsertError
          );
          // Don't necessarily fail the whole operation if DB insert fails after upload
          // Log error, but return success as the audio exists in storage
          console.warn("Audio chunk uploaded, but failed to save DB record.");
          // throw new AppError(AppErrorCode.DATABASE_ERROR, dbInsertError.message);
        }

        // 8. Get Public URL for the newly uploaded chunk
        const { data: urlData } = supabaseServiceRoleClient.storage
          .from(storageBucket)
          .getPublicUrl(storageFileName);

        console.log(`Generated and saved audio chunk ${uniqueChunkId}.`);

        return {
          success: true,
          data: {
            storagePath: fullStoragePath,
            publicUrl: urlData?.publicUrl || "",
            startTime: startTime,
            endTime: endTime,
          },
        };
      } catch (error) {
        console.error("Unexpected error in generateAudioChunk:", error);
        throw error; // Re-throw for safe-action client handler
      }
    }
  );
