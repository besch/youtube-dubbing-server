"use server";

import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import type { User } from "@supabase/supabase-js";
import { protectedAction } from "../safe-action";
import { supabaseServiceRoleClient } from "@/lib/supabase/serviceRoleClient";
import { ActionResponse, AppError, appErrors, AppErrorCode } from "../actions";
import { extractYoutubeVideoId } from "./utils";
import {
  internalRequestFullTranscription,
  internalTranslateFullContent,
  internalSpawnTtsJobs,
} from "../videoInternal"; // Import necessary internal actions
import type { Tables } from "@/types/supabase"; // Import Supabase types
import { inngest } from "@/inngest/client"; // Import Inngest client

// Define the possible status values explicitly
type ProcessingStatusValue =
  | "pending"
  | "downloading"
  | "transcribing_full"
  | "translating_full"
  | "generating_audio"
  | "completed"
  | "failed";

// Zod schema for input validation
const startVideoProcessingSchema = z.object({
  youtubeUrl: z.string().url("Invalid YouTube URL"),
});

interface StartProcessingOutput {
  videoId: string;
  downloadJobId: string;
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
              console.warn(
                `oEmbed request for ${youtubeId} failed with status ${oembedResponse.status}.`
              );
            } else {
              const oembedData = await oembedResponse.json();
              fetchedTitle = oembedData.title || null;
              fetchedThumbnailUrl = oembedData.thumbnail_url || null;
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
          }

          const videoTitle = fetchedTitle || "Untitled Video";
          const videoThumbnail = fetchedThumbnailUrl;

          const { data: newVideo, error: insertVideoError } = await supabase
            .from("videos")
            .insert({
              youtube_id: youtubeId,
              title: videoTitle,
              thumbnail_url: videoThumbnail,
              duration: duration,
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

        console.log(
          `[startVideoProcessing] About to fetch downloader service. Job ID: ${downloadJobId}, URL: ${youtubeUrl}`
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

        const requestBody = {
          youtube_url: youtubeUrl,
          job_id: downloadJobId,
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
          body: JSON.stringify(requestBody),
        }).catch(async (fetchError) => {
          console.error(
            `Failed to *initiate* fetch call to downloader service for job ${downloadJobId}:`,
            fetchError
          );
        });

        console.log(
          `Successfully requested download job ${downloadJobId} for video ${videoId}. Returning control to client.`
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
        if (error instanceof AppError) {
          throw error;
        }
        throw appErrors.UNEXPECTED_ERROR;
      }
    }
  );

// --- Initiate Video Processing Job (Called by Client) ---
const initiateVideoProcessingJobSchema = z.object({
  youtubeUrl: z.string().url("Invalid YouTube URL"),
  processingTargets: z
    .record(
      z.string(), // Language code (e.g., "en") - Now represents target lang code
      z.object({ voice: z.string() }) // Voice for that language
    )
    .refine((val) => Object.keys(val).length > 0, {
      message: "At least one processing target must be provided",
    }),
});

interface InitiateProcessingOutput {
  videoId: string;
  downloadJobId: string | null; // Can be null if download already exists/triggered previously
  initialProcessingStatus: Record<string, any>; // The state AFTER this action runs
}

export const initiateVideoProcessingJob = protectedAction
  .schema(initiateVideoProcessingJobSchema)
  .action(
    async ({
      parsedInput,
      ctx,
    }: {
      parsedInput: z.infer<typeof initiateVideoProcessingJobSchema>;
      ctx: { user: User };
    }): Promise<ActionResponse<InitiateProcessingOutput>> => {
      const userId = ctx.user.id;
      const { youtubeUrl, processingTargets } = parsedInput;

      const downloaderServiceUrl = process.env.DOWNLOADER_SERVICE_URL;
      if (!downloaderServiceUrl) {
        console.error("DOWNLOADER_SERVICE_URL is not set.");
        return { success: false, error: appErrors.CONFIGURATION_ERROR };
      }

      let youtubeId: string;
      try {
        youtubeId = extractYoutubeVideoId(youtubeUrl);
      } catch (error) {
        return {
          success: false,
          error: error instanceof AppError ? error : appErrors.INVALID_INPUT,
        };
      }

      const supabase = supabaseServiceRoleClient;

      try {
        // 1. Find or Create Video Record
        let videoId: string;
        let existingProcessingStatus: Record<string, any> = {};

        const { data: existingVideo, error: videoCheckError } = await supabase
          .from("videos")
          .select("id, processing_status")
          .eq("youtube_id", youtubeId)
          .maybeSingle();

        if (videoCheckError) {
          console.error(
            `InitiateJob: Error checking for existing video ${youtubeId}:`,
            videoCheckError
          );
          throw appErrors.DATABASE_ERROR;
        }

        if (existingVideo) {
          videoId = existingVideo.id;
          existingProcessingStatus =
            (existingVideo.processing_status as Record<string, any>) || {};
          console.log(
            `InitiateJob: Found existing video ${videoId} for ${youtubeId}`
          );
        } else {
          console.log(
            `InitiateJob: Video ${youtubeId} not found. Creating new record.`
          );
          // Fetch metadata (similar to startVideoProcessing)
          let fetchedTitle: string | null = null;
          let fetchedThumbnailUrl: string | null = null;
          try {
            const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
              youtubeUrl
            )}&format=json`;
            const oembedResponse = await fetch(oembedUrl);
            if (oembedResponse.ok) {
              const oembedData = await oembedResponse.json();
              fetchedTitle = oembedData.title || null;
              fetchedThumbnailUrl = oembedData.thumbnail_url || null;
            }
          } catch (metaError: any) {
            console.warn(
              `InitiateJob: Failed to fetch metadata for ${youtubeId}:`,
              metaError?.message
            );
          }
          const videoTitle = fetchedTitle || "Untitled Video";
          const videoThumbnail = fetchedThumbnailUrl;

          const { data: newVideo, error: insertVideoError } = await supabase
            .from("videos")
            .insert({
              youtube_id: youtubeId,
              title: videoTitle,
              thumbnail_url: videoThumbnail,
              processing_status: {}, // Start with empty status
            })
            .select("id")
            .single();

          if (insertVideoError) {
            if (insertVideoError.code === "23505") {
              // Handle race condition
              const { data: raceVideo, error: raceError } = await supabase
                .from("videos")
                .select("id, processing_status")
                .eq("youtube_id", youtubeId)
                .single();
              if (raceError || !raceVideo) {
                console.error(
                  `InitiateJob: Error fetching video after insert race condition for ${youtubeId}:`,
                  raceError
                );
                throw appErrors.DATABASE_ERROR;
              }
              videoId = raceVideo.id;
              existingProcessingStatus =
                (raceVideo.processing_status as Record<string, any>) || {};
            } else {
              console.error(
                `InitiateJob: Error inserting new video for ${youtubeId}:`,
                insertVideoError
              );
              throw appErrors.DATABASE_ERROR;
            }
          } else {
            videoId = newVideo!.id;
          }
          console.log(`InitiateJob: Created new video record ${videoId}`);
        }

        // 2. Check Prerequisites (Download & Transcription)
        let downloadJobId: string | null = null;
        let downloadStoragePath: string | null = null;
        let isDownloadComplete = false;
        let transcriptionData: Tables<"transcription_segments"> | null = null;
        let isTranscriptionComplete = false;

        // Check latest completed download job
        const { data: completedDownloadJob, error: downloadCheckError } =
          await supabase
            .from("download_jobs")
            .select("id, status, storage_path")
            .eq("video_id", videoId)
            .eq("status", "completed")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (downloadCheckError) {
          console.error(
            `InitiateJob: Error checking completed download job for video ${videoId}:`,
            downloadCheckError
          );
          // Proceed cautiously, assume download is needed unless proven otherwise
        } else if (completedDownloadJob?.storage_path) {
          isDownloadComplete = true;
          downloadJobId = completedDownloadJob.id; // Store ID of completed job
          downloadStoragePath = completedDownloadJob.storage_path;
          console.log(
            `InitiateJob: Found completed download job ${downloadJobId} for video ${videoId}.`
          );
        }

        // Check for completed transcription row
        if (isDownloadComplete) {
          const {
            data: completedTranscription,
            error: transcriptionCheckError,
          } = await supabase
            .from("transcription_segments")
            .select("*") // Select all columns for later use
            .eq("video_id", videoId)
            .eq("status", "completed")
            .maybeSingle();

          if (transcriptionCheckError) {
            console.error(
              `InitiateJob: Error checking completed transcription for video ${videoId}:`,
              transcriptionCheckError
            );
          } else if (completedTranscription) {
            isTranscriptionComplete = true;
            transcriptionData = completedTranscription; // Store full data
            console.log(
              `InitiateJob: Found completed transcription row ${transcriptionData.id} for video ${videoId}.`
            );
          }
        }

        console.log(
          `InitiateJob: Prerequisite check for ${videoId}: Download Complete: ${isDownloadComplete}, Transcription Complete: ${isTranscriptionComplete}`
        );

        // 3. Construct and Update Processing Status for NEW targets
        const newProcessingStatus = { ...existingProcessingStatus };
        let needsStatusUpdate = false;
        const languagesToTranslate = new Set<string>();
        const targetsToSpawnTts = new Set<string>(); // Store "lang_voice" keys

        for (const langCode in processingTargets) {
          const voice = processingTargets[langCode].voice;
          const langVoiceKey = `${langCode}_${voice}`;

          const currentTargetStatus = newProcessingStatus[langVoiceKey]?.status;
          const isTerminal =
            currentTargetStatus === "completed" ||
            currentTargetStatus === "failed";

          // Only process if the target is NEW or NOT in a terminal state
          if (!isTerminal) {
            // Use the defined type alias here
            let targetInitialStatus: ProcessingStatusValue = "pending"; // Default

            if (isDownloadComplete && isTranscriptionComplete) {
              // Check if translation already exists in the fetched data
              let translationExists = false;
              if (
                transcriptionData?.translations &&
                typeof transcriptionData.translations === "object" &&
                !Array.isArray(transcriptionData.translations) &&
                transcriptionData.translations !== null
              ) {
                // Cast to a temporary variable first
                const translationsObj =
                  transcriptionData.translations as Record<string, any>;
                translationExists = !!translationsObj[langCode];
              }

              if (translationExists) {
                targetInitialStatus = "generating_audio";
                targetsToSpawnTts.add(langVoiceKey);
                console.log(
                  `InitiateJob: Target ${langVoiceKey} initial status -> generating_audio (Non-EN, Translation Exists)`
                );
              } else {
                targetInitialStatus = "translating_full";
                languagesToTranslate.add(langCode);
                console.log(
                  `InitiateJob: Target ${langVoiceKey} initial status -> translating_full (Non-EN, Translation Needed)`
                );
              }
            } else {
              // Prerequisites not met, stays pending
              targetInitialStatus = "pending";
              console.log(
                `InitiateJob: Target ${langVoiceKey} initial status -> pending (Prereqs Not Met)`
              );
            }

            // Update status only if it's different or new
            if (
              !newProcessingStatus[langVoiceKey] ||
              newProcessingStatus[langVoiceKey]?.status !== targetInitialStatus
            ) {
              newProcessingStatus[langVoiceKey] = {
                status: targetInitialStatus,
                progress: targetInitialStatus === "pending" ? 0 : 5, // Small progress if past pending
                last_updated: new Date().toISOString(),
              };
              needsStatusUpdate = true;
            }
          } else {
            console.log(
              `InitiateJob: Skipping target ${langVoiceKey} as it's already in terminal state: ${currentTargetStatus}`
            );
          }
        }

        // Update the database only if changes were made
        if (needsStatusUpdate) {
          console.log(
            `InitiateJob: Updating processing status for video ${videoId}:`,
            JSON.stringify(newProcessingStatus, null, 2)
          );
          const { error: updateError } = await supabase
            .from("videos")
            .update({ processing_status: newProcessingStatus })
            .eq("id", videoId);

          if (updateError) {
            console.error(
              `InitiateJob: Error updating processing status for ${videoId}:`,
              updateError
            );
            // Continue processing but log the error, status might be stale
          }
        } else {
          console.log(
            `InitiateJob: No status updates needed for video ${videoId}.`
          );
        }

        // 4. Trigger Downstream Actions IF NEEDED
        let triggerDownload = false;
        let triggerTranscription = false;

        if (!isDownloadComplete) {
          // Need to trigger download if no completed job was found
          // Check if a download is already processing
          const { data: processingJob, error: processingCheckError } =
            await supabase
              .from("download_jobs")
              .select("id, status")
              .eq("video_id", videoId)
              .in("status", ["processing", "pending"])
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

          if (processingCheckError) {
            console.error(
              `InitiateJob: Error checking processing download job for video ${videoId}:`,
              processingCheckError
            );
          }

          if (!processingJob) {
            // No completed AND no pending/processing job -> trigger download
            triggerDownload = true;
            console.log(
              `InitiateJob: No existing download job found for ${videoId}. Triggering new download.`
            );
          } else {
            downloadJobId = processingJob.id; // Use the ID of the ongoing job
            console.log(
              `InitiateJob: Download job ${downloadJobId} for video ${videoId} is already pending/processing. No trigger needed.`
            );
          }
        }

        // Trigger download ONLY if necessary
        if (triggerDownload) {
          const newJobId = uuidv4();
          console.log(
            `InitiateJob: Creating new download job ${newJobId} for video ${videoId}`
          );
          const { error: insertJobError } = await supabase
            .from("download_jobs")
            .insert({
              id: newJobId,
              video_id: videoId,
              user_id: userId, // Associate with the requesting user
              status: "pending",
            });

          if (insertJobError) {
            console.error(
              `InitiateJob: Error inserting new download job ${newJobId}:`,
              insertJobError
            );
            // Don't throw, but log. Status is already set to pending.
          } else {
            downloadJobId = newJobId; // Update downloadJobId to the newly created one
            // Call downloader service (fire-and-forget)
            fetch(`${downloaderServiceUrl}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                youtube_url: youtubeUrl,
                job_id: newJobId,
              }),
            }).catch((fetchError) => {
              console.error(
                `InitiateJob: Failed to trigger downloader service for job ${newJobId}:`,
                fetchError
              );
              // Log error, but the job is in the DB
            });
          }
        }

        // Trigger transcription if download is done but transcription isn't
        if (isDownloadComplete && !isTranscriptionComplete) {
          console.log(
            `InitiateJob: Download complete, transcription not. Triggering internalRequestFullTranscription for ${videoId}.`
          );
          triggerTranscription = true;
        }

        // Execute triggers AFTER status update
        if (triggerTranscription) {
          if (!downloadStoragePath) {
            console.error(
              `InitiateJob: Cannot trigger transcription for ${videoId}, downloadStoragePath is missing!`
            );
            // Mark relevant processing_status as failed? Or just log? Log for now.
          } else {
            try {
              // Call the internal action directly
              // NOTE: We don't need to await this if the goal is just to kick it off.
              // The Supabase triggers will handle the flow from its completion.
              // However, if we wanted to know if the trigger call itself failed immediately, we could await.
              // For simplicity and to avoid blocking, let's not await.
              await internalRequestFullTranscription({
                videoId: videoId,
                audioStoragePath: downloadStoragePath,
              });
              console.log(
                `InitiateJob: Trigger call sent for internalRequestFullTranscription for ${videoId}.`
              );
            } catch (transcriptionTriggerError: any) {
              console.error(
                `InitiateJob: Error trying to trigger internalRequestFullTranscription for ${videoId}:`,
                transcriptionTriggerError
              );
              // Log error, subsequent steps might fail if transcription doesn't start
            }
          }
        } else if (isDownloadComplete && isTranscriptionComplete) {
          // Trigger translation and/or TTS spawning if prereqs are met
          console.log(
            `InitiateJob: Prereqs met for ${videoId}. Triggering translation/TTS spawning.`
          );

          // Trigger Translations
          if (languagesToTranslate.size > 0 && transcriptionData?.id) {
            console.log(
              `InitiateJob: Triggering translation for languages: ${[
                ...languagesToTranslate,
              ].join(", ")}`
            );
            for (const lang of languagesToTranslate) {
              try {
                // Await the call now
                await internalTranslateFullContent({
                  segmentId: transcriptionData.id,
                  targetLanguage: lang,
                });
              } catch (translateTriggerError: any) {
                console.error(
                  `InitiateJob: Error trying to trigger internalTranslateFullContent for ${lang}:`,
                  translateTriggerError
                );
              }
            }
          } else if (languagesToTranslate.size > 0 && !transcriptionData?.id) {
            console.error(
              `InitiateJob: Cannot trigger translation for ${videoId}, transcriptionData.id is missing!`
            );
          }

          // Trigger TTS Spawning
          if (targetsToSpawnTts.size > 0) {
            console.log(
              `InitiateJob: Triggering TTS spawning for targets: ${[
                ...targetsToSpawnTts,
              ].join(", ")}`
            );
            for (const langVoiceKey of targetsToSpawnTts) {
              const [lang, voice] = langVoiceKey.split("_");
              try {
                // Don't await - let the on-translation-complete trigger handle this
                internalSpawnTtsJobs({
                  videoId: videoId,
                  language: lang,
                  voice: voice,
                });
              } catch (spawnTriggerError: any) {
                console.error(
                  `InitiateJob: Error trying to trigger internalSpawnTtsJobs for ${langVoiceKey}:`,
                  spawnTriggerError
                );
              }
            }
          }
        }

        // 5. Return Success
        // Fetch the final status after updates and triggers
        const { data: finalVideoData, error: finalVideoError } = await supabase
          .from("videos")
          .select("processing_status")
          .eq("id", videoId)
          .single();

        const finalProcessingStatus = finalVideoError
          ? newProcessingStatus // Use calculated status if fetch fails
          : finalVideoData?.processing_status || newProcessingStatus;

        return {
          success: true,
          data: {
            videoId: videoId,
            downloadJobId: downloadJobId, // Return the relevant job ID (could be old completed, new pending, or ongoing)
            initialProcessingStatus: finalProcessingStatus as Record<
              string,
              any
            >,
          },
        };
      } catch (error) {
        console.error(
          `InitiateJob: Unhandled error caught in initiateVideoProcessingJob action for ${youtubeId}:`,
          error
        );
        // Ensure the error is an AppError before returning
        const appErr =
          error instanceof AppError
            ? error
            : new AppError(
                AppErrorCode.UNEXPECTED_ERROR,
                error instanceof Error
                  ? error.message
                  : "Unknown error during video processing initiation"
              );
        return { success: false, error: appErr };
      }
    }
  );

// --- Get Video Details By URL Action ---

const getVideoByUrlSchema = z.object({
  youtubeUrl: z.string().url("Invalid YouTube URL"),
});

interface GetVideoByUrlOutput {
  id: string;
  processing_status: Tables<"videos">["processing_status"];
  duration: number | null;
}

export const getVideoByUrl = protectedAction
  .schema(getVideoByUrlSchema)
  .action(
    async ({
      parsedInput,
    }): Promise<ActionResponse<GetVideoByUrlOutput | null>> => {
      const { youtubeUrl } = parsedInput;
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
          .select("id, processing_status, duration")
          .eq("youtube_id", youtubeId)
          .maybeSingle();

        if (videoCheckError) {
          console.error("Error fetching video by youtube_id:", videoCheckError);
          throw appErrors.DATABASE_ERROR;
        }

        if (!existingVideo) {
          // Return success with null data if video not found
          return { success: true, data: null };
        }

        return { success: true, data: existingVideo };
      } catch (error: any) {
        console.error("Error in getVideoByUrl action:", error);
        if (error instanceof AppError) {
          return { success: false, error: error };
        }
        return { success: false, error: appErrors.UNEXPECTED_ERROR };
      }
    }
  );

// --- Retry Processing Target Action ---

const retryProcessingTargetSchema = z.object({
  videoId: z.string().uuid(),
  language: z.string(),
  voice: z.string(),
});

export const retryProcessingTarget = protectedAction
  .schema(retryProcessingTargetSchema)
  .action(
    async ({ parsedInput }): Promise<ActionResponse<{ success: boolean }>> => {
      const { videoId, language, voice } = parsedInput;
      const supabase = supabaseServiceRoleClient;
      const langVoiceKey = `${language}_${voice}`;

      console.log(
        `[Retry Action] Attempting to retry target ${langVoiceKey} for video ${videoId}`
      );

      try {
        // 1. Fetch Current Video Status
        const { data: videoData, error: fetchError } = await supabase
          .from("videos")
          .select("processing_status")
          .eq("id", videoId)
          .single();

        if (fetchError || !videoData) {
          console.error(
            `[Retry Action] Failed to fetch video ${videoId}: ${fetchError?.message}`
          );
          return {
            success: false,
            error: appErrors.RECORD_NOT_FOUND,
          };
        }

        const currentProcessingStatus = (videoData.processing_status ||
          {}) as Record<string, any>; // Type assertion for simplicity
        const targetStatus = currentProcessingStatus[langVoiceKey];

        if (!targetStatus || targetStatus.status !== "failed") {
          console.log(
            `[Retry Action] Target ${langVoiceKey} for video ${videoId} is not in 'failed' state (Status: ${targetStatus?.status}). No retry needed.`
          );
          return { success: true, data: { success: true } }; // Already processing or completed
        }

        console.log(
          `[Retry Action] Target ${langVoiceKey} is in failed state. Determining restart point...`
        );

        // 2. Determine Restart Point and Reset Status
        let newStatus: Partial<typeof targetStatus> = {};
        let jobToEnqueue: { name: string; data: any } | null = null;

        // Simplistic restart logic: If failed, try restarting from translation or initial TTS spawn.
        // More sophisticated logic could inspect the error message or progress.

        // Fetch the associated transcription segment to determine if translation exists
        const { data: transcriptionSegment, error: segmentError } =
          await supabase
            .from("transcription_segments")
            .select("id, translations")
            .eq("video_id", videoId)
            .maybeSingle();

        if (segmentError) {
          console.error(
            `[Retry Action] Error fetching transcription segment for ${videoId}: ${segmentError.message}`
          );
          // Default to retrying translation if segment fetch fails?
          newStatus = {
            status: "transcribing_full", // Reset to state before translation/TTS
            error_message: null,
            progress: 5, // Reset progress
            last_updated: new Date().toISOString(),
          };
          // Cannot enqueue specific job without segmentId
          console.warn(
            `[Retry Action] Could not determine segment ID, only resetting status.`
          );
        } else if (!transcriptionSegment) {
          console.warn(
            `[Retry Action] No transcription segment found for video ${videoId}. Cannot retry.`
          );
          return {
            success: false,
            error: new AppError(
              AppErrorCode.DEPENDENCY_NOT_READY,
              "Transcription not found for retry."
            ),
          };
        } else {
          const translations = (transcriptionSegment.translations ||
            {}) as Record<string, any>;
          const translationExists =
            translations[language]?.segments?.length > 0;

          if (language === "en" || translationExists) {
            // If English, or translation already exists, restart TTS spawning
            console.log(
              `[Retry Action] Restarting at TTS Spawn for ${langVoiceKey}.`
            );
            newStatus = {
              status: "generating_audio", // State before TTS starts
              error_message: null,
              progress: 15, // Reset progress slightly past translation
              last_updated: new Date().toISOString(),
            };
            jobToEnqueue = {
              name: "tts/spawn-initial",
              data: { videoId, language, voice },
            };
          } else {
            // If non-English and translation doesn't exist, restart translation
            console.log(
              `[Retry Action] Restarting at Translation for ${langVoiceKey}.`
            );
            newStatus = {
              status: "translating_full", // State before translation starts
              error_message: null,
              progress: 10, // Reset progress slightly past transcription
              last_updated: new Date().toISOString(),
            };
            jobToEnqueue = {
              name: "translation/request",
              data: {
                segmentId: transcriptionSegment.id,
                targetLanguage: language,
              },
            };
          }
        }

        // 3. Update Video Status in DB
        const updatedProcessingStatus = {
          ...currentProcessingStatus,
          [langVoiceKey]: newStatus,
        };

        const { error: updateError } = await supabase
          .from("videos")
          .update({ processing_status: updatedProcessingStatus })
          .eq("id", videoId);

        if (updateError) {
          console.error(
            `[Retry Action] Failed to update video status for ${videoId}: ${updateError.message}`
          );
          return {
            success: false,
            error: appErrors.DATABASE_ERROR,
          };
        }

        // 4. Enqueue the Starting Job (if determined)
        if (jobToEnqueue) {
          try {
            await inngest.send(jobToEnqueue as any); // Use 'as any' for simplicity or create union type for events
            console.log(
              `[Retry Action] Successfully enqueued starting job '${jobToEnqueue.name}' for ${langVoiceKey}.`
            );
          } catch (enqueueError: any) {
            console.error(
              `[Retry Action] Failed to enqueue job '${jobToEnqueue.name}' for ${langVoiceKey}: ${enqueueError.message}`
            );
            // Status is already updated, but log that enqueue failed.
            // User might need to retry again.
            return {
              success: false,
              error: new AppError(
                AppErrorCode.SERVICE_ERROR,
                `Failed to enqueue retry job: ${enqueueError.message}`
              ),
            };
          }
        }

        console.log(
          `[Retry Action] Successfully reset status for ${langVoiceKey}.`
        );
        return { success: true, data: { success: true } };
      } catch (error: unknown) {
        console.error(
          `[Retry Action] Unexpected error for ${langVoiceKey} video ${videoId}:`,
          error
        );
        const appErr =
          error instanceof AppError
            ? error
            : new AppError(
                AppErrorCode.UNEXPECTED_ERROR,
                error instanceof Error
                  ? error.message
                  : "Unknown error during retry action"
              );
        return { success: false, error: appErr };
      }
    }
  );
