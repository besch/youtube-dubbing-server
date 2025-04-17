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

    // Calculate Progress (Simple example: based on latest chunk end time)
    const progress = Math.min(
      99,
      Math.floor((chunkEndTime / videoDuration) * 100)
    ); // Cap at 99 until confirmed complete

    // Check if this chunk completes the video
    // TODO: This check is naive. We need to verify ALL expected chunks are present.
    // This might involve querying the translated_audio_chunks table to count/sum durations
    // or checking if the end time of the *last* transcribed segment has a corresponding audio chunk.
    const isLikelyComplete = chunkEndTime >= videoDuration;

    // Update Status
    if (!processingConfig[langVoiceKey]) {
      processingConfig[langVoiceKey] = {}; // Initialize if somehow missing
    }

    if (isLikelyComplete) {
      // TODO: Add robust check here to confirm completion before setting status
      console.log(
        `Marking process ${langVoiceKey} for video ${dbVideoId} as COMPLETED.`
      );
      processingConfig[langVoiceKey].status = "completed";
      processingConfig[langVoiceKey].progress = 100;
    } else {
      processingConfig[langVoiceKey].status = "generating_audio"; // Keep status as generating
      processingConfig[langVoiceKey].progress = progress;
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
