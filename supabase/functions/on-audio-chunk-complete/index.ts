import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../utils/cors.ts";

// Define types for the incoming webhook payload
interface AudioChunkPayload {
  type: "INSERT";
  table: "translated_audio_chunks";
  record: {
    id: string;
    video_id: string;
    language: string;
    voice: string;
    chunk_start: number;
    chunk_end: number;
    storage_path: string;
    // Add other fields if necessary
  };
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

    const {
      video_id: dbVideoId,
      language,
      voice,
      chunk_end: chunkEndTime,
    } = payload.record;
    const langVoiceKey = `${language}_${voice}`;
    console.log(
      `Processing audio chunk completion for ${dbVideoId} - ${langVoiceKey} (ends at ${chunkEndTime})`
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
    const { data: videoData, error: videoError } = await supabaseAdmin
      .from("videos")
      .select("duration, processing_status")
      .eq("id", dbVideoId)
      .single();

    if (videoError || !videoData || !videoData.duration) {
      console.error(
        `Error fetching video details for ${dbVideoId} in audio chunk handler:`,
        videoError
      );
      // Don't throw, just log and exit? Or should this update status to failed?
      return new Response(
        JSON.stringify({
          error: `Video ${dbVideoId} not found or duration missing`,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 404, // Or 500?
        }
      );
    }

    const processingConfig = videoData.processing_status || {};
    const videoDuration = videoData.duration;

    // Check if the process for this lang/voice is already completed or failed
    if (
      processingConfig[langVoiceKey]?.status === "completed" ||
      processingConfig[langVoiceKey]?.status === "failed"
    ) {
      console.log(
        `Process ${langVoiceKey} for video ${dbVideoId} already terminal. Ignoring chunk update.`
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

    // 1. Fetch COMPLETED transcription segments to determine expected chunks
    const { data: segmentsData, error: segmentsError } = await supabaseAdmin
      .from("transcription_segments")
      .select("id, content, translations") // Select content and translations
      .eq("video_id", dbVideoId)
      .eq("status", "completed")
      .order("start_time", { ascending: true });

    if (segmentsError) {
      console.error(
        `Error fetching transcription segments for count check (${dbVideoId}):`,
        segmentsError
      );
      // Can't determine expected count, proceed without marking complete
    } else if (segmentsData && segmentsData.length > 0) {
      // Calculate expected count based on the target language
      for (const segment of segmentsData) {
        const segmentJson = segment as any; // Use 'as any' for simplicity
        let subSegments = null;
        if (language === "en") {
          subSegments = segmentJson.content?.segments;
        } else {
          subSegments = segmentJson.translations?.[language]?.segments;
        }

        if (subSegments && Array.isArray(subSegments)) {
          // Count only valid segments with start and end times
          expectedChunkCount += (subSegments as any[]).filter(
            (s) => s.start !== undefined && s.end !== undefined
          ).length;
        }
      }
      console.log(
        `Count Check (${dbVideoId}/${langVoiceKey}): Expected chunk count = ${expectedChunkCount}`
      );
    } else {
      console.log(
        `Count Check (${dbVideoId}/${langVoiceKey}): No completed transcription segments found.`
      );
      // No segments means 0 expected chunks? Or should this be an error?
      // For now, assume 0 expected if no source segments found.
      expectedChunkCount = 0;
    }

    // 2. Count actual generated chunks for this language/voice
    const { count: fetchedChunkCount, error: countError } = await supabaseAdmin
      .from("translated_audio_chunks")
      .select("*", { count: "exact", head: true }) // Use head:true for efficient counting
      .eq("video_id", dbVideoId)
      .eq("language", language)
      .eq("voice", voice);

    if (countError) {
      console.error(
        `Error counting existing chunks (${dbVideoId}/${langVoiceKey}):`,
        countError
      );
      // Can't determine actual count, proceed without marking complete
    } else {
      actualChunkCount = fetchedChunkCount ?? 0;
      console.log(
        `Count Check (${dbVideoId}/${langVoiceKey}): Actual chunk count = ${actualChunkCount}`
      );
    }

    // 3. Compare counts and determine status/progress
    if (expectedChunkCount > 0 && actualChunkCount >= expectedChunkCount) {
      console.log(
        `Determined process ${langVoiceKey} for video ${dbVideoId} is COMPLETE based on chunk count.`
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
        `Count Check (${dbVideoId}/${langVoiceKey}): Expected count is 0, treating as complete.`
      );
      // If 0 are expected and 0 (or more, somehow) exist, consider it complete.
      isComplete = true;
      calculatedProgress = 100;
    }
    // --- End New Completion Check --- //

    // Update Status
    if (!processingConfig[langVoiceKey]) {
      processingConfig[langVoiceKey] = {}; // Initialize if somehow missing
    }

    if (isComplete) {
      // Use the new count-based check result
      console.log(
        `Marking process ${langVoiceKey} for video ${dbVideoId} as COMPLETED.`
      );
      processingConfig[langVoiceKey].status = "completed";
      processingConfig[langVoiceKey].progress = 100;
    } else {
      processingConfig[langVoiceKey].status = "generating_audio"; // Keep status as generating
      processingConfig[langVoiceKey].progress = calculatedProgress; // Use the calculated progress
    }
    processingConfig[langVoiceKey].last_updated = new Date().toISOString();

    // Update Video Processing Status in DB
    const { error: updateError } = await supabaseAdmin
      .from("videos")
      .update({ processing_status: processingConfig })
      .eq("id", dbVideoId);

    if (updateError) {
      console.error(
        `Error updating video processing status for ${dbVideoId} after audio chunk update:`,
        updateError
      );
      // Log error, but likely continue
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
