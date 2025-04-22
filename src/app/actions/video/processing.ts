"use server";

import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import type { User } from "@supabase/supabase-js";
import { protectedAction } from "../safe-action";
import { supabaseServiceRoleClient } from "@/lib/supabase/serviceRoleClient";
import { ActionResponse, AppError, appErrors } from "../actions";
import { extractYoutubeVideoId } from "./utils";

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
      z.string(), // Language code (e.g., "en")
      z.object({ voice: z.string() }) // Voice for that language
    )
    .refine((val) => Object.keys(val).length > 0, {
      message: "At least one processing target must be provided",
    }),
});

interface InitiateProcessingOutput {
  videoId: string;
  downloadJobId: string | null; // Can be null if download already exists
  initialProcessingStatus: Record<string, any>;
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
          console.error("Error checking for existing video:", videoCheckError);
          throw appErrors.DATABASE_ERROR;
        }

        if (existingVideo) {
          videoId = existingVideo.id;
          existingProcessingStatus =
            (existingVideo.processing_status as Record<string, any>) || {};
          console.log(`Found existing video ${videoId} for ${youtubeId}`);
        } else {
          console.log(`Video ${youtubeId} not found. Creating new record.`);
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
              `Failed to fetch metadata for ${youtubeId}:`,
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
              if (raceError || !raceVideo) throw appErrors.DATABASE_ERROR;
              videoId = raceVideo.id;
              existingProcessingStatus =
                (raceVideo.processing_status as Record<string, any>) || {};
            } else {
              throw appErrors.DATABASE_ERROR;
            }
          } else {
            videoId = newVideo!.id;
          }
          console.log(`Created new video record ${videoId}`);
        }

        // 2. Construct and Update Processing Status
        const newProcessingStatus = { ...existingProcessingStatus };
        let needsProcessingUpdate = false;

        for (const langCode in processingTargets) {
          const voice = processingTargets[langCode].voice;
          const langVoiceKey = `${langCode}_${voice}`;
          // Add only if not already completed or failed
          if (
            newProcessingStatus[langVoiceKey]?.status !== "completed" &&
            newProcessingStatus[langVoiceKey]?.status !== "failed"
          ) {
            if (!newProcessingStatus[langVoiceKey]) {
              newProcessingStatus[langVoiceKey] = {
                status: "pending", // Initial status before download
                progress: 0,
                last_updated: new Date().toISOString(),
              };
              needsProcessingUpdate = true;
            }
          }
        }

        if (needsProcessingUpdate) {
          console.log(
            `Updating processing status for video ${videoId}:`,
            newProcessingStatus
          );
          const { error: updateError } = await supabase
            .from("videos")
            .update({ processing_status: newProcessingStatus })
            .eq("id", videoId);
          if (updateError) {
            console.error(
              "Error updating initial processing status:",
              updateError
            );
          }
        }

        // 3. Check Download Job Status and Trigger Download if Needed
        let downloadJobId: string | null = null;
        const { data: existingJob, error: jobCheckError } = await supabase
          .from("download_jobs")
          .select("id, status")
          .eq("video_id", videoId)
          .in("status", ["completed", "processing"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (jobCheckError) {
          console.error("Error checking download job:", jobCheckError);
        }

        if (
          existingJob?.status === "completed" ||
          existingJob?.status === "processing"
        ) {
          console.log(
            `Download job ${existingJob.id} for video ${videoId} already exists/processing. Status: ${existingJob.status}`
          );
          downloadJobId = existingJob.id;
        } else {
          const newJobId = uuidv4();
          console.log(
            `Triggering new download job ${newJobId} for video ${videoId}`
          );
          const { error: insertJobError } = await supabase
            .from("download_jobs")
            .insert({
              id: newJobId,
              video_id: videoId,
              user_id: userId,
              status: "pending",
            });

          if (insertJobError) {
            console.error("Error inserting new download job:", insertJobError);
            throw appErrors.DATABASE_ERROR;
          }

          downloadJobId = newJobId;

          fetch(`${downloaderServiceUrl}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ youtube_url: youtubeUrl, job_id: newJobId }),
          }).catch((fetchError) => {
            console.error(
              `Failed to trigger downloader service for job ${newJobId}:`,
              fetchError
            );
          });
        }

        // 4. Return Success
        return {
          success: true,
          data: {
            videoId: videoId,
            downloadJobId: downloadJobId,
            initialProcessingStatus: newProcessingStatus,
          },
        };
      } catch (error) {
        console.error(
          "Error caught in initiateVideoProcessingJob action:",
          error
        );
        if (error instanceof AppError) {
          throw error;
        }
        throw appErrors.UNEXPECTED_ERROR;
      }
    }
  );
