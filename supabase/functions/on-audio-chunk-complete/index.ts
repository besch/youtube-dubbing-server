import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../utils/cors.ts";
import type { Tables } from "../_shared/supabaseTypes.ts"; // Assuming types are generated/shared
import type { ReplicateSegmentOutput } from "../_shared/replicateTypes.ts"; // Assuming types are shared

// Define types for the incoming webhook payload
interface AudioChunkPayload {
  type: "INSERT";
  table: "translated_audio_chunks";
  record: Tables<"translated_audio_chunks">; // Use generated type
}

// Define VideoProcessingStatus locally
interface VideoProcessingStatusDetail {
  status:
    | "pending"
    | "downloading"
    | "transcribing_full"
    | "translating_full"
    | "generating_audio"
    | "completed"
    | "failed";
  progress?: number;
  error_message?: string | null | undefined;
  last_updated?: string;
}
type VideoProcessingStatus = Record<string, VideoProcessingStatusDetail>;

// Helper to call the atomic status update RPC function
async function updateVideoStatusRPC(
  supabaseAdmin: ReturnType<typeof createClient>,
  videoId: string,
  langVoiceKey: string,
  statusDetail: any
) {
  console.log(
    `[on-audio-chunk] Calling RPC update_processing_status for ${videoId} - ${langVoiceKey}:`,
    statusDetail
  );
  // Use a separate try/catch for the RPC itself to avoid stopping the function on update failure
  try {
    const { error: rpcError } = await supabaseAdmin.rpc(
      "update_processing_status",
      {
        video_uuid: videoId,
        status_key: langVoiceKey,
        status_value: statusDetail,
      }
    );

    if (rpcError) {
      console.error(
        `[on-audio-chunk] RPC Error updating status for ${videoId} - ${langVoiceKey}:`,
        rpcError
      );
      // Don't throw here, just log. The main function should still return 200.
    }
  } catch (rpcCatchError) {
    console.error(
      `[on-audio-chunk] Caught exception during RPC call for ${videoId} - ${langVoiceKey}:`,
      rpcCatchError
    );
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload: AudioChunkPayload = await req.json();

    // Validate Payload
    if (
      payload.type !== "INSERT" ||
      payload.table !== "translated_audio_chunks"
    ) {
      console.log("Ignoring irrelevant audio chunk update:", payload);
      return new Response(JSON.stringify({ message: "Irrelevant update" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Destructure needed fields from the inserted audio chunk record
    const {
      video_id: dbVideoId,
      language,
      voice,
      chunk_end: chunkEndTime, // Keep for logging clarity if needed
    } = payload.record;
    const langVoiceKey = `${language}_${voice}`;
    console.log(
      `[on-audio-chunk] Processing INSERT for ${dbVideoId} - ${langVoiceKey} (ends at ${chunkEndTime})`
    );

    // Supabase Client
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        global: {
          headers: {
            Authorization: `Bearer ${Deno.env.get(
              "SUPABASE_SERVICE_ROLE_KEY"
            )}`,
          },
        },
      }
    );

    // Fetch Video Details (Duration & Current Status)
    // Duration might not be strictly needed for calculation anymore if relying solely on counts,
    // but keep it for now, might be useful context.
    const { data: videoData, error: videoError } = await supabaseAdmin
      .from("videos")
      .select("duration, processing_status")
      .eq("id", dbVideoId)
      .single();

    if (videoError || !videoData) {
      console.error(
        `[on-audio-chunk] Error fetching video details for ${dbVideoId}:`,
        videoError
      );
      // Don't throw, update status to failed?
      // For now, just return error response.
      return new Response(
        JSON.stringify({
          error: `Video ${dbVideoId} not found or details missing`,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 404,
        }
      );
    }

    const processingConfig = (videoData.processing_status ||
      {}) as VideoProcessingStatus;
    const videoDuration = videoData.duration;

    // Check if the process for this lang/voice is already completed or failed
    const currentTargetStatus = processingConfig[langVoiceKey]?.status;
    if (
      currentTargetStatus === "completed" ||
      currentTargetStatus === "failed"
    ) {
      console.log(
        `[on-audio-chunk] Process ${langVoiceKey} for video ${dbVideoId} already terminal (${currentTargetStatus}). Ignoring chunk update.`
      );
      return new Response(
        JSON.stringify({ message: "Process already terminal" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    // --- New Completion Check based on Chunk Counts --- //
    let expectedInitialChunkCount = 0; // Count chunks <= 60s
    let totalExpectedChunkCount = 0; // Count all chunks for progress calculation
    let isInitialComplete = false;
    let actualInitialChunkCount = 0; // Count generated chunks <= 60s
    let calculatedProgress = 0; // Initialize progress

    // 1. Fetch the SINGLE completed transcription row for the video
    const { data: transcriptionData, error: transcriptionError } =
      await supabaseAdmin
        .from("transcription_segments")
        .select("id, content, translations") // Select content and translations
        .eq("video_id", dbVideoId)
        .eq("status", "completed") // Ensure transcription itself is done
        // .order("start_time", { ascending: true }); // No need to order
        .maybeSingle(); // Expect 0 or 1 row

    if (transcriptionError) {
      console.error(
        `[on-audio-chunk] Error fetching transcription data for count check (${dbVideoId}):`,
        transcriptionError
      );
      // Can't determine expected count, mark as failed
      processingConfig[langVoiceKey] = {
        ...processingConfig[langVoiceKey],
        status: "failed",
        error_message:
          "Failed to fetch transcription data to check completion.",
        last_updated: new Date().toISOString(),
      };
    } else if (transcriptionData) {
      // Calculate expected counts based on the target language from the single transcription row
      let subSegments = null;
      const content =
        transcriptionData.content as ReplicateSegmentOutput | null;
      const translations = transcriptionData.translations as Record<
        string,
        ReplicateSegmentOutput
      > | null;

      if (language === "en") {
        subSegments = content?.segments;
      } else {
        subSegments = translations?.[language]?.segments;
      }

      if (subSegments && Array.isArray(subSegments)) {
        const validSegments = (subSegments as any[]).filter(
          (s) => s.start !== undefined && s.end !== undefined
        );
        totalExpectedChunkCount = validSegments.length; // Total valid segments
        // Count only valid segments ending within the first 60 seconds
        expectedInitialChunkCount = validSegments.filter(
          (s) => s.end <= 60
        ).length;
      } else {
        // No sub-segments found
        console.warn(
          `[on-audio-chunk] Count Check (${dbVideoId}/${langVoiceKey}): No sub-segments found in ${
            language === "en" ? "content" : `translations[${language}]`
          }. Assuming 0 expected.`
        );
        totalExpectedChunkCount = 0;
        expectedInitialChunkCount = 0;
      }
      console.log(
        `[on-audio-chunk] Count Check (${dbVideoId}/${langVoiceKey}): Expected Initial (<=60s) = ${expectedInitialChunkCount}, Total Expected = ${totalExpectedChunkCount}`
      );
    } else {
      console.log(
        `[on-audio-chunk] Count Check (${dbVideoId}/${langVoiceKey}): No completed transcription row found.`
      );
      // Assume 0 expected if no source transcription found.
      totalExpectedChunkCount = 0;
      expectedInitialChunkCount = 0;
    }

    // Only proceed with counting actual chunks if no error fetching transcription
    if (!processingConfig[langVoiceKey]?.error_message) {
      // 2. Count actual generated chunks for this language/voice ENDING WITHIN 60 SECONDS
      const { count: fetchedInitialChunkCount, error: countError } =
        await supabaseAdmin
          .from("translated_audio_chunks")
          .select("*", { count: "exact", head: true }) // Use head:true for efficient counting
          .eq("video_id", dbVideoId)
          .eq("language", language)
          .eq("voice", voice)
          .lte("chunk_end", 60); // Filter for chunks ending <= 60s

      if (countError) {
        console.error(
          `[on-audio-chunk] Error counting existing initial chunks (${dbVideoId}/${langVoiceKey}):`,
          countError
        );
        // Mark as failed if count fails
        processingConfig[langVoiceKey] = {
          ...processingConfig[langVoiceKey],
          status: "failed",
          error_message: "Failed to count generated initial audio chunks.",
          last_updated: new Date().toISOString(),
        };
      } else {
        actualInitialChunkCount = fetchedInitialChunkCount ?? 0;
        console.log(
          `[on-audio-chunk] Count Check (${dbVideoId}/${langVoiceKey}): Actual Initial (<=60s) chunk count = ${actualInitialChunkCount}`
        );
      }
    }

    // 3. Compare INITIAL counts and determine status/progress (only if not already marked as failed)
    if (!processingConfig[langVoiceKey]?.error_message) {
      // Check if the initial generation phase is complete
      if (
        expectedInitialChunkCount > 0 &&
        actualInitialChunkCount >= expectedInitialChunkCount
      ) {
        console.log(
          `[on-audio-chunk] Determined INITIAL generation phase for ${langVoiceKey} video ${dbVideoId} is COMPLETE.`
        );
        isInitialComplete = true;
        // Don't calculate progress based on initial here, status will be 'completed'
        // We will set progress to 100 when setting status to 'completed'
      } else if (expectedInitialChunkCount > 0) {
        // Calculate progress based on initial chunks if initial phase not yet complete
        calculatedProgress = Math.min(
          99, // Cap progress at 99 until initial phase is truly complete
          Math.floor(
            (actualInitialChunkCount / expectedInitialChunkCount) * 100
          )
        );
        isInitialComplete = false; // Not complete yet
      } else {
        // Handle case where expectedInitialChunkCount is 0
        console.log(
          `[on-audio-chunk] Count Check (${dbVideoId}/${langVoiceKey}): Expected initial count is 0, treating initial phase as complete.`
        );
        isInitialComplete = true; // If 0 are expected, the initial phase is done.
      }

      // 4. Update Video Processing Status
      const now = new Date().toISOString();
      if (isInitialComplete) {
        // Only update to completed if the current status is still 'generating_audio'
        if (currentTargetStatus === "generating_audio") {
          processingConfig[langVoiceKey] = {
            status: "completed", // Mark as completed now
            progress: 100, // Set progress to 100
            last_updated: now,
            error_message: null, // Clear any previous non-fatal errors
          };
          console.log(
            `[on-audio-chunk] Updating status for ${langVoiceKey} video ${dbVideoId} to 'completed'.`
          );
        } else {
          // If status somehow changed from 'generating_audio' already, log it but don't overwrite
          console.log(
            `[on-audio-chunk] Initial generation complete for ${langVoiceKey} video ${dbVideoId}, but current status is ${currentTargetStatus}. Not overwriting.`
          );
          // Keep existing status/progress/error if it wasn't 'generating_audio'
          processingConfig[langVoiceKey] = {
            ...processingConfig[langVoiceKey], // Keep existing details
            last_updated: now, // Just update timestamp
          };
        }
      } else {
        // Initial generation is not complete, update progress if status is 'generating_audio'
        if (currentTargetStatus === "generating_audio") {
          processingConfig[langVoiceKey] = {
            ...processingConfig[langVoiceKey], // Keep existing details like error message if any
            status: "generating_audio", // Keep status
            progress: calculatedProgress, // Update progress
            last_updated: now,
          };
          console.log(
            `[on-audio-chunk] Updating progress for ${langVoiceKey} video ${dbVideoId} to ${calculatedProgress}%.`
          );
        } else {
          // If status is not 'generating_audio' (e.g., 'translating_full'), don't revert progress/status
          console.log(
            `[on-audio-chunk] Received chunk for ${langVoiceKey} video ${dbVideoId}, but current status is ${currentTargetStatus}. Not updating progress.`
          );
          processingConfig[langVoiceKey] = {
            ...processingConfig[langVoiceKey],
            last_updated: now,
          };
        }
      }

      // --- Update Video Processing Status in DB --- //
      // Use the RPC helper for atomic update
      await updateVideoStatusRPC(
        supabaseAdmin,
        dbVideoId,
        langVoiceKey,
        processingConfig[langVoiceKey]
      );
    } // End of if (!processingConfig[langVoiceKey]?.error_message)

    // Return success
    return new Response(JSON.stringify({ message: "Audio chunk processed" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error in on-audio-chunk-complete function:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
