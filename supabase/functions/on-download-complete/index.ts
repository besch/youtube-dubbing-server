import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../utils/cors.ts";

// Define types for the incoming webhook payload
interface DownloadJobPayload {
  type: "UPDATE";
  table: "download_jobs";
  record: {
    id: string;
    video_id: string;
    status: "pending" | "processing" | "completed" | "failed";
    storage_path: string | null; // Added storage_path
    error_message: string | null;
    // Add other fields if necessary
  };
  old_record: {
    status: "pending" | "processing" | "completed" | "failed";
    // Add other fields if necessary
  } | null;
}

const NEXTJS_API_URL = Deno.env.get("NEXTJS_API_URL"); // e.g., http://host.docker.internal:3000 for local docker
const FUNCTION_SECRET = Deno.env.get("FUNCTION_SECRET"); // Secret to authenticate calls between functions/server

// Helper function to call the internal Next.js action trigger
async function triggerNextAction(actionName: string, payload: any) {
  const actionUrl = `${NEXTJS_API_URL}/api/internal/trigger-action`;
  console.log(`Triggering action '${actionName}' with payload:`, payload);

  if (!NEXTJS_API_URL || !FUNCTION_SECRET) {
    console.error(
      "NEXTJS_API_URL or FUNCTION_SECRET env variables are not set."
    );
    throw new Error("Internal trigger action configuration missing.");
  }

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
    // Extract message if available, otherwise stringify
    const errorMessage = result.error?.message ?? JSON.stringify(result.error);
    throw new Error(`Internal action ${actionName} failed: ${errorMessage}`);
  }

  return result;
}

// Helper to call the atomic status update RPC function
async function updateVideoStatusRPC(
  supabaseAdmin: ReturnType<typeof createClient>,
  videoId: string,
  langVoiceKey: string,
  statusDetail: any
) {
  console.log(
    `[on-download-complete] Calling RPC update_processing_status for ${videoId} - ${langVoiceKey}:`,
    statusDetail
  );
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
      `[on-download-complete] RPC Error updating status for ${videoId} - ${langVoiceKey}:`,
      rpcError
    );
    // Throw error to be caught by the main handler
    throw new Error(
      `Failed to update status via RPC for ${langVoiceKey}: ${rpcError.message}`
    );
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Parse Payload
    const payload: DownloadJobPayload = await req.json();

    // 2. Validate Payload - Only trigger on status 'completed' with a storage_path
    if (
      payload.type !== "UPDATE" ||
      payload.table !== "download_jobs" ||
      payload.record.status !== "completed" ||
      payload.old_record?.status === "completed" ||
      !payload.record.storage_path // Ensure storage path exists
    ) {
      console.log("Ignoring irrelevant update:", payload);
      return new Response(JSON.stringify({ message: "Irrelevant update" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const { video_id: dbVideoId, storage_path: fullAudioStoragePath } =
      payload.record;
    console.log(
      `Download completed for video ID: ${dbVideoId}. Audio path: ${fullAudioStoragePath}`
    );

    // 3. Create Supabase Admin Client
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

    // 4. Fetch Video Details (needed for processing status)
    const { data: videoData, error: videoError } = await supabaseAdmin
      .from("videos")
      .select("duration, processing_status") // Duration not strictly needed here anymore, but status is
      .eq("id", dbVideoId)
      .single();

    if (videoError || !videoData) {
      console.error(
        `Error fetching video details for ${dbVideoId}:`,
        videoError
      );
      throw new Error(`Failed to fetch video details for ${dbVideoId}`);
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

    // Update status for all pending targets to 'transcribing_full' using RPC
    // Use Promise.allSettled to handle potential individual failures
    const statusUpdatePromises = pendingTargets.map((key) => {
      const statusDetail = {
        status: "transcribing_full", // New status
        progress: 5, // Indicate download is done, transcription starting
        error_message: null,
        last_updated: new Date().toISOString(),
      };
      // Call the RPC helper for each target
      return updateVideoStatusRPC(supabaseAdmin, dbVideoId, key, statusDetail);
    });

    const results = await Promise.allSettled(statusUpdatePromises);
    const failedUpdates = results.filter((r) => r.status === "rejected");

    if (failedUpdates.length > 0) {
      console.error(
        `[on-download-complete] Failed to update status for ${failedUpdates.length} targets for video ${dbVideoId}. Errors:`,
        failedUpdates.map((f: any) => f.reason?.message)
      );
      // Decide how to proceed. Maybe don't trigger transcription if status updates failed?
      // For now, log and continue, but this could lead to inconsistent states.
      // Consider throwing an error if ANY status update fails.
      throw new Error(
        `Failed to update status for ${failedUpdates.length} targets.`
      );
    }

    // 5. Prepare and Call Next.js Action (Request Full Transcription)
    const actionPayload = {
      videoId: dbVideoId,
      audioStoragePath: fullAudioStoragePath, // Pass the full audio path
    };

    console.log(`Triggering FULL transcription for ${dbVideoId}...`);

    // Use the helper function
    // await triggerNextAction(
    //   "internalRequestFullTranscription", // New Action Name
    //   actionPayload
    // );

    try {
      await triggerNextAction(
        "internalRequestFullTranscription",
        actionPayload
      );
      console.log(
        `Successfully triggered internalRequestFullTranscription for ${dbVideoId}`
      );
    } catch (actionError) {
      console.error(
        `[on-download-complete] Failed to trigger internalRequestFullTranscription for ${dbVideoId}:`,
        actionError.message
      );
      // If triggering the action fails, mark all pending targets as failed
      const errorUpdatePromises = pendingTargets.map((key) => {
        const failureStatusDetail = {
          status: "failed" as const, // Ensure literal type
          error_message: `Failed to start transcription: ${actionError.message}`,
          last_updated: new Date().toISOString(),
          progress: 0,
        };
        return updateVideoStatusRPC(
          supabaseAdmin,
          dbVideoId,
          key,
          failureStatusDetail
        );
      });
      try {
        await Promise.allSettled(errorUpdatePromises);
        console.log(
          `[on-download-complete] Updated status to failed for targets of video ${dbVideoId} due to transcription trigger failure.`
        );
      } catch (e) {
        console.error(
          `[on-download-complete] Error updating statuses to failed after action trigger failure:`,
          e
        );
      }
      // Re-throw the error to ensure the function execution indicates failure
      throw actionError;
    }

    // 6. Return Success
    return new Response(
      JSON.stringify({ message: "Full transcription initiated" }),
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

// Define VideoProcessingStatus locally if not imported
interface VideoProcessingStatusDetail {
  status:
    | "pending"
    | "downloading"
    | "transcribing_full" // Updated status
    | "translating_full" // Added status
    | "generating_audio"
    | "completed"
    | "failed";
  progress?: number;
  error_message?: string | null | undefined;
  last_updated?: string;
}
type VideoProcessingStatus = Record<string, VideoProcessingStatusDetail>;
