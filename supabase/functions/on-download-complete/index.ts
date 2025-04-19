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

    // --- Determine target processes and update status --- //
    const currentProcessingStatus = (videoData.processing_status ||
      {}) as VideoProcessingStatus;
    const pendingTargets = Object.keys(currentProcessingStatus).filter(
      (key) => currentProcessingStatus[key]?.status === "pending"
    );

    if (pendingTargets.length === 0) {
      console.log(
        `No pending processes found for video ${dbVideoId}. Download complete, but nothing further to trigger.`
      );
      return new Response(
        JSON.stringify({
          message: "Download complete, no pending processes found.",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    console.log(`Found pending targets for ${dbVideoId}:`, pendingTargets);

    // Update status for all pending targets to 'transcribing'
    let needsUpdate = false;
    for (const key of pendingTargets) {
      if (currentProcessingStatus[key]) {
        // Check if key exists
        currentProcessingStatus[key] = {
          ...currentProcessingStatus[key], // Keep existing progress/error if any
          status: "transcribing",
          progress: 5, // Indicate download is done, transcription starting
          last_updated: new Date().toISOString(),
        };
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      const { error: updateError } = await supabaseAdmin
        .from("videos")
        .update({ processing_status: currentProcessingStatus })
        .eq("id", dbVideoId);

      if (updateError) {
        console.error(
          `Error updating video processing status to 'transcribing' for ${dbVideoId}:`,
          updateError
        );
        // Decide if this is fatal - maybe continue processing but log the error
      }
    } else {
      console.log(
        `No status updates needed for video ${dbVideoId} (targets might already be transcribing?).`
      );
    }

    // 6. Prepare and Call Next.js Action (Request Transcription) - ONCE
    const SEGMENT_DURATION = 180; // Should match the constant used elsewhere
    const firstSegmentEndTime = Math.min(SEGMENT_DURATION, videoData.duration);

    if (firstSegmentEndTime <= 0) {
      console.log(
        `Video ${dbVideoId} has zero or negative duration. Skipping transcription.`
      );
      // Update status to completed or failed?
      for (const key of pendingTargets) {
        if (currentProcessingStatus[key]) {
          currentProcessingStatus[key].status = "failed"; // Mark as failed due to invalid duration
          currentProcessingStatus[key].error_message =
            "Video has zero or negative duration";
          currentProcessingStatus[key].last_updated = new Date().toISOString();
        }
      }
      await supabaseAdmin
        .from("videos")
        .update({ processing_status: currentProcessingStatus })
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
      `Triggering *initial* transcription for ${dbVideoId}: ${actionPayload.startTime}-${actionPayload.endTime}` // Clarify log
    );

    const actionUrl = `${NEXTJS_API_URL}/api/internal/trigger-action`;

    // Use the helper function for consistency
    await triggerNextAction(
      "internalRequestTranscriptionSegment",
      actionPayload
    );

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

// Helper function (can be moved to utils if shared)
async function triggerNextAction(actionName: string, payload: any) {
  const actionUrl = `${NEXTJS_API_URL}/api/internal/trigger-action`;
  console.log(`Triggering action '${actionName}' with payload:`, payload);

  const response = await fetch(actionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${FUNCTION_SECRET}`,
    },
    body: JSON.stringify({ actionName, payload }),
  });

  // Response status code is checked here (should be 200 now)
  if (!response.ok) {
    const errorBody = await response.text();
    console.error(
      `Error calling action '${actionName}': ${response.status} ${response.statusText}`,
      errorBody
    );
    throw new Error(
      `Failed to trigger action '${actionName}': ${response.status} ${errorBody}`
    );
  }

  const result = await response.json();
  console.log(`Action '${actionName}' trigger response:`, result);

  // Check the success flag within the response body
  if (!result.success) {
    console.error(`Internal action ${actionName} failed:`, result.error);
    throw new Error(`Internal action ${actionName} failed.`);
  }

  return result;
}

// Define VideoProcessingStatus locally if not imported
interface VideoProcessingStatusDetail {
  status:
    | "pending"
    | "downloading"
    | "transcribing"
    | "translating"
    | "generating_audio"
    | "completed"
    | "failed";
  progress?: number;
  error_message?: string | null | undefined;
  last_updated?: string;
}
type VideoProcessingStatus = Record<string, VideoProcessingStatusDetail>;
