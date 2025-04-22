"use server";

import { z } from "zod";
import { protectedAction } from "../safe-action";
import { supabaseServiceRoleClient } from "@/lib/supabase/serviceRoleClient";
import { ActionResponse, AppError, AppErrorCode, appErrors } from "../actions";
import {
  startReplicateTranscription,
  type ReplicateSegmentOutput,
} from "@/lib/replicate";
import { getAudioSegmentPath } from "./helpers";

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
    }): Promise<ActionResponse<CompletedSegmentOutput | null>> => {
      const { videoId } = parsedInput;
      const supabase = supabaseServiceRoleClient;

      console.log(
        `[Action] Fetching completed transcription for video: ${videoId}`
      );

      try {
        const { data: segmentData, error } = await supabase
          .from("transcription_segments")
          .select("id, start_time, end_time, content, translations, status") // Select needed fields
          .eq("video_id", videoId)
          .eq("status", "completed")
          .maybeSingle(); // Fetch single row

        if (error) {
          console.error(
            `[Action] DB Error fetching transcription for ${videoId}:`,
            error.message
          );
          throw appErrors.DATABASE_ERROR;
        }

        if (!segmentData) {
          console.log(
            `[Action] No completed transcription found for video ${videoId}.`
          );
          return { success: true, data: null }; // Return null if not found/completed
        }

        console.log(
          `[Action] Found completed transcription for video ${videoId}.`
        );
        // Assuming CompletedSegmentOutput is compatible with the row structure
        return { success: true, data: segmentData as CompletedSegmentOutput };
      } catch (error: unknown) {
        const appErr =
          error instanceof AppError ? error : appErrors.UNEXPECTED_ERROR;
        console.error(
          `[Action] Unexpected error fetching transcription for ${videoId}:`,
          error
        );
        return { success: false, error: appErr };
      }
    }
  );

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

        let dbSegmentId: string | undefined = undefined;
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
            console.log(
              `RequestSegment: Found existing segment for ${videoId} (${startTime}-${endTime}) with status '${existingSegment.status}'. Proceeding to update and start Replicate job.`
            );
            dbSegmentId = existingSegment.id;
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
            `RequestSegment: Inserted/Confirmed DB segment record with ID: ${dbSegmentId}`
          );
        } else {
          console.log(
            `RequestSegment: Using existing DB segment record with ID: ${dbSegmentId}`
          );
        }

        // 5. Start Replicate Transcription
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
          .from("transcription_segments")
          .update({
            replicate_prediction_id: replicatePredictionId,
            status: "processing",
            segment_storage_path: segmentStoragePath,
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
          `RequestSegment: Successfully updated/initiated segment ${dbSegmentId!} for ${videoId} (${startTime}-${endTime}), Replicate ID: ${replicatePredictionId}`
        );
        return { success: true, data: { success: true } };
      } catch (error: unknown) {
        console.error(`RequestSegment: Error caught in main try block:`, error);
        const appErr =
          error instanceof AppError
            ? error
            : new AppError(
                AppErrorCode.UNEXPECTED_ERROR,
                error instanceof Error
                  ? error.message
                  : "Unknown error in requestTranscriptionSegment"
              );
        console.error(
          `RequestSegment: Returning failure response with error:`,
          JSON.stringify(appErr, null, 2)
        );
        return { success: false, error: appErr };
      }
    }
  );
