import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../utils/cors.ts";

// Define types for the incoming webhook payload (adjust as needed)
interface DownloadJobPayload {
  type: "UPDATE";
  table: "download_jobs";
  record: {
    id: string;
    video_id: string;
    status: "pending" | "processing" | "completed" | "failed";
    error_message: string | null;
    // Add other fields if necessary
  };
  old_record: {
    status: "pending" | "processing" | "completed" | "failed";
    // Add other fields if necessary
  } | null;
}

const NEXTJS_API_URL = Deno.env.get("NEXTJS_API_URL"); // e.g., http://localhost:3000 or your deployed URL
const FUNCTION_SECRET = Deno.env.get("FUNCTION_SECRET"); // Secret to authenticate calls between functions/server

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Authentication/Authorization (Optional but recommended)
    // You might want to add a secret header check here if calling directly

    // 2. Parse Payload
    const payload: DownloadJobPayload = await req.json();

    // 3. Validate Payload
    if (
      payload.type !== "UPDATE" ||
      payload.table !== "download_jobs" ||
      payload.record.status !== "completed" ||
      payload.old_record?.status === "completed" // Ignore if already completed
    ) {
      console.log("Ignoring irrelevant update:", payload);
      return new Response(JSON.stringify({ message: "Irrelevant update" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const { video_id: dbVideoId } = payload.record;
    console.log(`Download completed for video ID: ${dbVideoId}`);

    // 4. Create Supabase Admin Client
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

    // 5. Fetch Video Details (Duration is needed for first segment)
    const { data: videoData, error: videoError } = await supabaseAdmin
      .from("videos")
      .select("duration, processing_status")
      .eq("id", dbVideoId)
      .single();

    if (videoError || !videoData || !videoData.duration) {
      console.error(
        `Error fetching video details for ${dbVideoId}:`,
        videoError
      );
      throw new Error(
        `Failed to fetch video details or duration missing for ${dbVideoId}`
      );
    }

    // --- TODO: Update processing_status in videos table ---
    // This logic will become more complex, tracking per language/voice.
    // For now, we assume a single process starts.
    // We need to know the target language/voice pairs intended for this video.
    // This might come from the initial request that created the video entry,
    // or potentially default user settings if not specified.
    // Let's assume for now we trigger for a default "en_nova" process.

    const langVoiceKey = "en_nova"; // Placeholder
    const processingStatus = videoData.processing_status || {};
    processingStatus[langVoiceKey] = {
      status: "transcribing",
      progress: 5, // Indicate download is done
      last_updated: new Date().toISOString(),
    };

    const { error: updateError } = await supabaseAdmin
      .from("videos")
      .update({ processing_status: processingStatus })
      .eq("id", dbVideoId);

    if (updateError) {
      console.error(
        `Error updating video processing status for ${dbVideoId}:`,
        updateError
      );
      // Decide if this is fatal - maybe continue processing but log the error
    }

    // 6. Prepare and Call Next.js Action (Request Transcription)
    const SEGMENT_DURATION = 180; // Should match the constant used elsewhere
    const firstSegmentEndTime = Math.min(SEGMENT_DURATION, videoData.duration);

    if (firstSegmentEndTime <= 0) {
      console.log(
        `Video ${dbVideoId} has zero or negative duration. Skipping transcription.`
      );
      // Update status to completed or failed?
      processingStatus[langVoiceKey].status = "completed"; // Or failed?
      await supabaseAdmin
        .from("videos")
        .update({ processing_status: processingStatus })
        .eq("id", dbVideoId);
      return new Response(
        JSON.stringify({ message: "Video duration invalid, skipping." }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    const actionPayload = {
      videoId: dbVideoId,
      startTime: 0,
      endTime: firstSegmentEndTime,
    };

    console.log(
      `Triggering transcription for ${dbVideoId}: ${actionPayload.startTime}-${actionPayload.endTime}`
    );

    const actionUrl = `${NEXTJS_API_URL}/api/internal/trigger-action`; // New internal endpoint

    const response = await fetch(actionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${FUNCTION_SECRET}`, // Authenticate server-to-server
      },
      body: JSON.stringify({
        actionName: "internalRequestTranscriptionSegment",
        payload: actionPayload,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(
        `Error calling internal API (trigger-action -> internalRequestTranscriptionSegment): Status ${response.status}, Body: ${errorBody}`
      );
      throw new Error(
        `Failed to trigger transcription via internal API. Status: ${response.status}`
      );
    }

    const result = await response.json();
    console.log("Internal API call result:", result);
    // Check if the action itself reported failure
    if (!result.success) {
      console.error(
        `Internal action internalRequestTranscriptionSegment failed:`,
        result.error
      );
      // Throw an error to potentially retry the function or signal failure
      throw new Error(
        `Internal action internalRequestTranscriptionSegment failed.`
      );
    }

    // 7. Return Success
    return new Response(
      JSON.stringify({ message: "Transcription initiated" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error in on-download-complete function:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
