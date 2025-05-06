import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../utils/cors.ts";
import type { Tables } from "../_shared/supabaseTypes.ts"; // Assuming types are generated/shared
import type { ReplicateSegmentOutput } from "../_shared/replicateTypes.ts"; // Assuming types are shared

// Define types for the incoming webhook payload
interface TranscriptionSegmentPayload {
  type: "UPDATE";
  table: "transcription_segments";
  record: Tables<"transcription_segments">; // Use generated type
  old_record: {
    status?: Tables<"transcription_segments">["status"];
    translations?: Tables<"transcription_segments">["translations"];
  } | null;
}

interface VideoProcessingStatusDetail {
  status:
    | "pending"
    | "downloading"
    | "transcribing_full" // Use new status
    | "translating_full" // Use new status
    | "generating_audio"
    | "completed"
    | "failed";
  progress?: number;
  error_message?: string | null | undefined;
  last_updated?: string;
}
type VideoProcessingStatus = Record<string, VideoProcessingStatusDetail>;

const NEXTJS_API_URL = Deno.env.get("NEXTJS_API_URL");
const FUNCTION_SECRET = Deno.env.get("FUNCTION_SECRET");

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
    `[on-transcription-complete] Calling RPC update_processing_status for ${videoId} - ${langVoiceKey}:`,
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
      `[on-transcription-complete] RPC Error updating status for ${videoId} - ${langVoiceKey}:`,
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
    const payload: TranscriptionSegmentPayload = await req.json();
    console.log(
      "[on-transcription-complete] Parsed Payload:",
      JSON.stringify(payload, null, 2)
    );

    // --- Validation --- //
    // Only proceed if the full transcription just completed
    const isCompletion =
      payload.type === "UPDATE" &&
      payload.record.status === "completed" &&
      payload.old_record?.status !== "completed";

    const isFailure =
      payload.type === "UPDATE" &&
      payload.record.status === "failed" &&
      payload.old_record?.status !== "failed";

    if (!isCompletion && !isFailure) {
      console.log(
        `[on-transcription-complete] Ignoring update for segment ${payload.record.id} - Not a completion or failure event.`
      );
      return new Response(JSON.stringify({ message: "Irrelevant update" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const {
      id: segmentId, // This is the ID of the single transcription_segments row
      video_id: dbVideoId,
    } = payload.record;
    console.log(
      `[on-transcription-complete] Full transcription COMPLETED for video ${dbVideoId} (Segment Row ID: ${segmentId}). Initiating next steps.`
    );

    // --- Supabase Client --- //
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

    // --- Fetch Video Details (Processing Status) --- //
    const { data: videoData, error: videoError } = await supabaseAdmin
      .from("videos")
      .select("processing_status") // Only need processing_status
      .eq("id", dbVideoId)
      .single();

    if (videoError || !videoData) {
      console.error(
        `[on-transcription-complete] Error fetching video details for ${dbVideoId}:`,
        videoError
      );
      throw new Error(
        `Failed to fetch video details for ${dbVideoId} after transcription update.`
      );
    }

    const processingConfig = (videoData.processing_status ||
      {}) as VideoProcessingStatus;

    if (isFailure) {
      console.log(
        `[on-transcription-complete] Full transcription FAILED for video ${dbVideoId} (Segment Row ID: ${segmentId}). Updating relevant statuses.`
      );
      const targetsToFail = Object.keys(processingConfig).filter(
        (key) => processingConfig[key]?.status === "transcribing_full"
      );
      const failureUpdatePromises = targetsToFail.map((key) => {
        const failureDetail = {
          status: "failed" as const,
          error_message:
            payload.record.error_message || "Transcription job failed.",
          last_updated: new Date().toISOString(),
          progress: 0,
        };
        return updateVideoStatusRPC(
          supabaseAdmin,
          dbVideoId,
          key,
          failureDetail
        );
      });
      await Promise.allSettled(failureUpdatePromises);
      console.log(
        `[on-transcription-complete] Updated ${targetsToFail.length} statuses to failed for video ${dbVideoId}.`
      );
      return new Response(
        JSON.stringify({ message: "Transcription failure processed" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    // If it's a completion, proceed...
    const targetProcesses = Object.keys(processingConfig).filter(
      (key) => processingConfig[key]?.status === "transcribing_full" // Only process targets waiting for transcription
    );

    if (targetProcesses.length === 0) {
      console.log(
        `[on-transcription-complete] No processes in 'transcribing_full' state found for video ${dbVideoId}. Skipping further actions.`
      );
      return new Response(JSON.stringify({ message: "No active processes" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    console.log(
      `[on-transcription-complete] Found targets for video ${dbVideoId}:`,
      targetProcesses
    );

    // Extract full transcription content
    const fullTranscriptionContent = payload.record
      .content as ReplicateSegmentOutput | null; // Use shared type

    // --- Prepare status updates and trigger calls --- //
    const statusUpdates: { key: string; detail: any }[] = [];
    const translationTriggers: { segmentId: string; lang: string }[] = [];
    const ttsSpawnTriggers: { videoId: string; lang: string; voice: string }[] =
      [];
    let overallError: Error | null = null; // Track if any trigger fails critically

    if (
      !fullTranscriptionContent ||
      !Array.isArray(fullTranscriptionContent.segments) ||
      fullTranscriptionContent.segments.length === 0
    ) {
      console.error(
        `[on-transcription-complete] Completed transcription for ${dbVideoId} (Segment ID: ${segmentId}) has no valid content. Marking targets as failed.`
      );
      // Mark relevant processes as failed using the RPC helper
      for (const langVoiceKey of targetProcesses) {
        const failureDetail = {
          ...processingConfig[langVoiceKey], // Keep existing info if possible
          status: "failed",
          error_message:
            "Transcription completed but content was empty/invalid.",
          last_updated: new Date().toISOString(),
        };
        // Immediately try to update status to failed
        try {
          await updateVideoStatusRPC(
            supabaseAdmin,
            dbVideoId,
            langVoiceKey,
            failureDetail
          );
        } catch (updateError) {
          console.error(
            `Failed to update status to failed for ${langVoiceKey} after empty content: ${updateError.message}`
          );
        }
      }
      throw new Error("Transcription content missing or invalid.");
    }

    // --- Logic for Each Target Process (Language/Voice) --- //
    // Determine updates and triggers first, apply later
    for (const langVoiceKey of targetProcesses) {
      const [language, voice] = langVoiceKey.split("_");
      console.log(
        `[on-transcription-complete] Processing target: ${langVoiceKey}`
      );

      if (language === "en") {
        // --- English: Schedule status update and TTS spawns --- //
        console.log(
          `[on-transcription-complete] Target ${langVoiceKey} is English. Scheduling TTS spawn.`
        );
        statusUpdates.push({
          key: langVoiceKey,
          detail: {
            status: "generating_audio", // Target state
            progress: 0, // Reset progress
            error_message: null,
            last_updated: new Date().toISOString(),
          },
        });

        // Schedule TTS spawn trigger (will execute after status updates)
        ttsSpawnTriggers.push({
          videoId: dbVideoId,
          lang: language,
          voice: voice,
        });
      } else {
        // --- Non-English: Schedule status update and translation trigger --- //
        console.log(
          `[on-transcription-complete] Target ${langVoiceKey} requires translation. Scheduling translation trigger.`
        );
        statusUpdates.push({
          key: langVoiceKey,
          detail: {
            status: "translating_full", // Target state
            progress: 0, // Reset progress
            error_message: null,
            last_updated: new Date().toISOString(),
          },
        });

        // Schedule translation trigger
        translationTriggers.push({ segmentId: segmentId, lang: language });
      }
    }

    // --- Apply Status Updates Atomically --- //
    if (statusUpdates.length > 0) {
      console.log(
        `[on-transcription-complete] Applying ${statusUpdates.length} status updates...`
      );
      const updatePromises = statusUpdates.map((update) =>
        updateVideoStatusRPC(
          supabaseAdmin,
          dbVideoId,
          update.key,
          update.detail
        )
      );
      const results = await Promise.allSettled(updatePromises);
      const failedUpdates = results.filter((r) => r.status === "rejected");
      if (failedUpdates.length > 0) {
        console.error(
          `[on-transcription-complete] ${failedUpdates.length} status updates FAILED for video ${dbVideoId}. Errors:`,
          failedUpdates.map((f: any) => f.reason?.message)
        );
        // If status updates fail, subsequent triggers might operate on incorrect states.
        // Throw an error to indicate a partial failure.
        overallError = new Error(
          `Failed to apply ${failedUpdates.length} status updates.`
        );
        // Don't proceed with triggers if status updates failed?
        // Let's throw for now to prevent inconsistent triggers.
        throw overallError;
      }
    }

    // --- Execute Triggers (Only if status updates succeeded) --- //
    console.log(
      `[on-transcription-complete] Executing triggers - Translations: ${translationTriggers.length}, TTS Spawns: ${ttsSpawnTriggers.length}`
    );

    // Trigger Translations
    const translationPromises = translationTriggers.map(async (trigger) => {
      try {
        return await triggerNextAction("internalTranslateFullContent", {
          segmentId: trigger.segmentId,
          targetLanguage: trigger.lang,
        });
      } catch (error) {
        console.error(
          `[on-transcription-complete] Failed to trigger internalTranslateFullContent for lang ${trigger.lang}, video ${dbVideoId}: ${error.message}`
        );
        // Find the langVoiceKey for this failed trigger to update its status
        const failedLangVoiceKey = Object.keys(processingConfig).find(
          (key) =>
            key.startsWith(`${trigger.lang}_`) &&
            processingConfig[key]?.status === "translating_full"
        );
        if (failedLangVoiceKey) {
          const failureDetail = {
            status: "failed" as const,
            error_message: `Translation trigger failed: ${error.message}`,
            last_updated: new Date().toISOString(),
            progress: 0,
          };
          try {
            await updateVideoStatusRPC(
              supabaseAdmin,
              dbVideoId,
              failedLangVoiceKey,
              failureDetail
            );
          } catch (rpcError) {
            console.error(
              `[on-transcription-complete] Error updating status to failed for ${failedLangVoiceKey} after translation trigger error: ${rpcError.message}`
            );
          }
        }
        throw error; // Re-throw to be caught by Promise.allSettled
      }
    });

    // Trigger TTS Spawns
    const ttsSpawnPromises = ttsSpawnTriggers.map(async (trigger) => {
      try {
        return await triggerNextAction("internalSpawnTtsJobs", {
          videoId: trigger.videoId,
          language: trigger.lang,
          voice: trigger.voice,
        });
      } catch (error) {
        console.error(
          `[on-transcription-complete] Failed to trigger internalSpawnTtsJobs for ${trigger.lang}_${trigger.voice}, video ${dbVideoId}: ${error.message}`
        );
        const failedLangVoiceKey = `${trigger.lang}_${trigger.voice}`;
        // Check if this key was indeed one being processed (its status should have been generating_audio after successful update)
        const statusBeforeTrigger = statusUpdates.find(
          (su) => su.key === failedLangVoiceKey
        )?.detail.status;
        if (failedLangVoiceKey && statusBeforeTrigger === "generating_audio") {
          const failureDetail = {
            status: "failed" as const,
            error_message: `TTS spawn trigger failed: ${error.message}`,
            last_updated: new Date().toISOString(),
            progress: 0,
          };
          try {
            await updateVideoStatusRPC(
              supabaseAdmin,
              dbVideoId,
              failedLangVoiceKey,
              failureDetail
            );
          } catch (rpcError) {
            console.error(
              `[on-transcription-complete] Error updating status to failed for ${failedLangVoiceKey} after TTS spawn trigger error: ${rpcError.message}`
            );
          }
        }
        throw error; // Re-throw to be caught by Promise.allSettled
      }
    });

    // Await all triggers concurrently
    const allTriggerPromises = [...translationPromises, ...ttsSpawnPromises];
    if (allTriggerPromises.length > 0) {
      const triggerResults = await Promise.allSettled(allTriggerPromises);
      const failedTriggers = triggerResults.filter(
        (r) => r.status === "rejected"
      );
      if (failedTriggers.length > 0) {
        console.error(
          `[on-transcription-complete] ${failedTriggers.length} downstream triggers FAILED for video ${dbVideoId}. Errors:`,
          failedTriggers.map((f: any) => f.reason?.message)
        );
        // Update status to failed for the targets whose triggers failed?
        // This requires mapping failures back to langVoiceKey, which is complex here.
        // For now, just log the error. The internal actions themselves might handle setting failed status.
        overallError = new Error(
          `Failed to execute ${failedTriggers.length} downstream triggers.`
        );
        // Consider if we need to throw here or allow partial success
      }
    }

    // --- Return Success (or indicate partial failure if triggers failed) --- //
    if (overallError) {
      console.warn(
        `[on-transcription-complete] Process completed with errors for video ${dbVideoId}.`
      );
      // Return 200, but the log indicates issues.
      // Alternatively, return 500 if any trigger failure is critical.
      return new Response(
        JSON.stringify({
          message: "Transcription processed, but downstream triggers failed.",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500, // Indicate server-side issues with triggers
        }
      );
    }

    console.log(
      `[on-transcription-complete] Successfully processed transcription completion for video ${dbVideoId}.`
    );
    return new Response(
      JSON.stringify({ message: "Transcription processed successfully" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error in on-transcription-complete function:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
