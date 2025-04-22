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
    let expectedChunkCount = 0;
    let isComplete = false;
    let actualChunkCount = 0; // Initialize actual count
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
      // Can't determine expected count, proceed without marking complete? Or fail?
      // Mark as failed for safety
      processingConfig[langVoiceKey] = {
        ...processingConfig[langVoiceKey],
        status: "failed",
        error_message:
          "Failed to fetch transcription data to check completion.",
        last_updated: new Date().toISOString(),
      };
    } else if (transcriptionData) {
      // Calculate expected count based on the target language from the single transcription row
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
        // Count only valid segments with start and end times
        expectedChunkCount = subSegments.filter(
          (s) => s.start !== undefined && s.end !== undefined
        ).length;
      } else {
        // No sub-segments found in the expected structure
        console.warn(
          `[on-audio-chunk] Count Check (${dbVideoId}/${langVoiceKey}): No sub-segments found in ${
            language === "en" ? "content" : `translations[${language}]`
          }. Assuming 0 expected.`
        );
        expectedChunkCount = 0;
      }
      console.log(
        `[on-audio-chunk] Count Check (${dbVideoId}/${langVoiceKey}): Expected chunk count = ${expectedChunkCount}`
      );
    } else {
      console.log(
        `[on-audio-chunk] Count Check (${dbVideoId}/${langVoiceKey}): No completed transcription row found.`
      );
      // No transcription means 0 expected chunks? Or should this be an error?
      // For now, assume 0 expected if no source transcription found.
      expectedChunkCount = 0;
    }

    // Only proceed with counting actual chunks if no error fetching transcription
    if (!processingConfig[langVoiceKey]?.error_message) {
      // 2. Count actual generated chunks for this language/voice
      const { count: fetchedChunkCount, error: countError } =
        await supabaseAdmin
          .from("translated_audio_chunks")
          .select("*", { count: "exact", head: true }) // Use head:true for efficient counting
          .eq("video_id", dbVideoId)
          .eq("language", language)
          .eq("voice", voice);

      if (countError) {
        console.error(
          `[on-audio-chunk] Error counting existing chunks (${dbVideoId}/${langVoiceKey}):`,
          countError
        );
        // Can't determine actual count, proceed without marking complete, potentially mark as failed?
        processingConfig[langVoiceKey] = {
          ...processingConfig[langVoiceKey],
          status: "failed", // Fail if count fails?
          error_message: "Failed to count generated audio chunks.",
          last_updated: new Date().toISOString(),
        };
      } else {
        actualChunkCount = fetchedChunkCount ?? 0;
        console.log(
          `[on-audio-chunk] Count Check (${dbVideoId}/${langVoiceKey}): Actual chunk count = ${actualChunkCount}`
        );
      }
    }

    // 3. Compare counts and determine status/progress (only if not already marked as failed)
    if (!processingConfig[langVoiceKey]?.error_message) {
      if (expectedChunkCount > 0 && actualChunkCount >= expectedChunkCount) {
        console.log(
          `[on-audio-chunk] Determined process ${langVoiceKey} for video ${dbVideoId} is COMPLETE based on chunk count.`
        );
        isComplete = true;
        calculatedProgress = 100;
      } else if (expectedChunkCount > 0) {
        calculatedProgress = Math.min(
          99,
          Math.floor((actualChunkCount / expectedChunkCount) * 100)
        );
        isComplete = false; // Not complete yet
      } else {
        // Handle case where expectedChunkCount is 0 (no transcription segments found or empty)
        console.log(
          `[on-audio-chunk] Count Check (${dbVideoId}/${langVoiceKey}): Expected count is 0, treating as complete.`
        );
        // If 0 are expected and 0 (or more, somehow) exist, consider it complete.
        isComplete = true;
        calculatedProgress = 100;
      }
      // --- End New Completion Check --- //

      // Update Status
      if (!processingConfig[langVoiceKey]) {
        processingConfig[langVoiceKey] = {} as VideoProcessingStatusDetail; // Initialize if somehow missing
      }

      if (isComplete) {
        // Use the new count-based check result
        console.log(
          `[on-audio-chunk] Marking process ${langVoiceKey} for video ${dbVideoId} as COMPLETED.`
        );
        processingConfig[langVoiceKey].status = "completed";
        processingConfig[langVoiceKey].progress = 100;
      } else {
        processingConfig[langVoiceKey].status = "generating_audio"; // Keep status as generating
        processingConfig[langVoiceKey].progress = calculatedProgress; // Use the calculated progress
      }
      processingConfig[langVoiceKey].last_updated = new Date().toISOString();
    }

    // Update Video Processing Status in DB (will update even if only error was set)
    const { error: updateError } = await supabaseAdmin
      .from("videos")
      .update({ processing_status: processingConfig })
      .eq("id", dbVideoId);

    if (updateError) {
      console.error(
        `[on-audio-chunk] Error updating video processing status for ${dbVideoId} after audio chunk update:`,
        updateError
      );
      // Log error, but likely continue and return success to webhook sender
    }

    // Return Success
    return new Response(
      JSON.stringify({ message: "Audio chunk update processed" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error in on-audio-chunk-complete function:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
