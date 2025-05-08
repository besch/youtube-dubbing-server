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

const NEXTJS_API_URL = Deno.env.get("NEXTJS_API_URL");
const FUNCTION_SECRET = Deno.env.get("FUNCTION_SECRET");

// Helper function to call the internal Next.js action trigger
async function triggerNextAction(actionName: string, payload: any) {
  const actionUrl = `${NEXTJS_API_URL}/api/internal/trigger-action`;
  console.log(
    `[on-translation-complete] Triggering action '${actionName}' with payload:`,
    payload
  );

  if (!NEXTJS_API_URL || !FUNCTION_SECRET) {
    console.error(
      "[on-translation-complete] NEXTJS_API_URL or FUNCTION_SECRET env variables are not set."
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
      `[on-translation-complete] Error calling action '${actionName}': ${response.status} ${response.statusText}`,
      errorBody
    );
    throw new Error(
      `Failed to trigger action '${actionName}': ${response.status} ${errorBody}`
    );
  }

  const result = await response.json();
  console.log(
    `[on-translation-complete] Action '${actionName}' trigger response:`,
    result
  );

  if (!result.success) {
    console.error(
      `[on-translation-complete] Internal action ${actionName} failed:`,
      result.error
    );
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
    `[on-translation-complete] Calling RPC update_processing_status for ${videoId} - ${langVoiceKey}:`,
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
      `[on-translation-complete] RPC Error updating status for ${videoId} - ${langVoiceKey}:`,
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
      "[on-translation-complete] Parsed Payload:",
      JSON.stringify(payload, null, 2)
    );

    // --- Validation --- //
    if (
      payload.type !== "UPDATE" ||
      !payload.record.translations || // Ensure translations field exists
      payload.record.status === "failed" || // Don't process if the main segment row is failed
      JSON.stringify(payload.record.translations) ===
        JSON.stringify(payload.old_record?.translations) // Ensure actual change
    ) {
      console.log(
        `[on-translation-complete] Ignoring update for segment ${payload.record.id} - Not a relevant translation update or segment is failed.`
      );
      return new Response(JSON.stringify({ message: "Irrelevant update" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const { id: segmentId, video_id: dbVideoId } = payload.record;
    const newTranslations = payload.record.translations as Record<string, any>; // Type assertion
    const oldTranslations = (payload.old_record?.translations ?? {}) as Record<
      string,
      any
    >; // Handle null old_record

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
        // Add auth schema if not public, e.g. auth: { schema: 'auth' }
      }
    );

    // --- Fetch Video Details (Processing Status) --- //
    const { data: videoData, error: videoError } = await supabaseAdmin
      .from("videos")
      .select("processing_status")
      .eq("id", dbVideoId)
      .single();

    if (videoError || !videoData) {
      console.error(
        `[on-translation-complete] Error fetching video details for ${dbVideoId}:`,
        videoError
      );
      throw new Error(
        `Failed to fetch video details for ${dbVideoId} after translation update.`
      );
    }

    const processingConfig = (videoData.processing_status ||
      {}) as VideoProcessingStatus;

    // --- Identify Newly Added/Updated Translations --- //
    const updatedLanguages = Object.keys(newTranslations).filter((lang) => {
      // Check if new lang content is valid and different from old
      const newLangContent = newTranslations[
        lang
      ] as ReplicateSegmentOutput | null;
      const oldLangContent = oldTranslations[
        lang
      ] as ReplicateSegmentOutput | null;
      return (
        newLangContent &&
        Array.isArray(newLangContent.segments) &&
        newLangContent.segments.length > 0 &&
        JSON.stringify(newLangContent) !== JSON.stringify(oldLangContent)
      );
    });

    if (updatedLanguages.length === 0) {
      console.log(
        `[on-translation-complete] No specific language changes detected for segment ${segmentId}. Might be an empty update?`
      );
      return new Response(JSON.stringify({ message: "No language change" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    console.log(
      `[on-translation-complete] Detected translation updates for languages: ${updatedLanguages.join(
        ", "
      )} in video ${dbVideoId}`
    );

    // --- Trigger TTS for Updated Languages --- //
    // Prepare updates and triggers
    const statusUpdatePromises: Promise<void>[] = [];
    const ttsSpawnPromises: Promise<any>[] = [];
    let overallError: Error | null = null;
    let processedTargetCount = 0;

    for (const language of updatedLanguages) {
      const translatedContent = newTranslations[
        language
      ] as ReplicateSegmentOutput | null;

      // This check is a bit redundant due to filter above, but good for safety
      if (
        !translatedContent ||
        !Array.isArray(translatedContent.segments) ||
        translatedContent.segments.length === 0
      ) {
        console.warn(
          `[on-translation-complete] Translation content for language ${language} in segment ${segmentId} is empty or invalid (should have been caught by filter). Skipping TTS.`
        );
        continue;
      }

      // Find corresponding lang/voice combinations that were waiting for translation
      const targetProcesses = Object.keys(processingConfig).filter((key) => {
        const [langKey, voiceKey] = key.split("_");
        return (
          langKey === language &&
          processingConfig[key]?.status === "translating_full"
        );
      });

      if (targetProcesses.length === 0) {
        console.log(
          `[on-translation-complete] No processes found waiting for translation of ${language} in video ${dbVideoId}.`
        );
        continue;
      }

      for (const langVoiceKey of targetProcesses) {
        const [, voice] = langVoiceKey.split("_"); // Get voice from key

        console.log(
          `[on-translation-complete] Processing target ${langVoiceKey} (status was 'translating_full'). Scheduling status update to 'generating_audio' and TTS spawn.`
        );
        processedTargetCount++;

        const statusDetail: VideoProcessingStatusDetail = {
          status: "generating_audio", // Update status first
          progress: 0, // Reset progress for new stage
          error_message: null,
          last_updated: new Date().toISOString(),
        };

        // Prepare status update promise
        statusUpdatePromises.push(
          updateVideoStatusRPC(
            supabaseAdmin,
            dbVideoId,
            langVoiceKey,
            statusDetail
          )
        );

        // Prepare trigger promise (will run after status updates)
        // This call is okay from an Edge Function.
        ttsSpawnPromises.push(
          triggerNextAction("internalSpawnTtsJobs", {
            videoId: dbVideoId,
            language: language,
            voice: voice,
          })
        );
      }
    }

    // --- Apply Status Updates Atomically --- //
    if (statusUpdatePromises.length > 0) {
      console.log(
        `[on-translation-complete] Applying ${statusUpdatePromises.length} status updates...`
      );
      const results = await Promise.allSettled(statusUpdatePromises);
      const failedUpdates = results.filter((r) => r.status === "rejected");
      if (failedUpdates.length > 0) {
        console.error(
          `[on-translation-complete] ${failedUpdates.length} status updates FAILED for video ${dbVideoId}. Errors:`,
          failedUpdates.map((f: any) => f.reason?.message)
        );
        overallError = new Error(
          `Failed to apply ${failedUpdates.length} status updates.`
        );
        // Don't execute TTS spawns if status updates failed
        throw overallError;
      }
    } else {
      console.log(`[on-translation-complete] No status updates needed.`);
    }

    // --- Execute TTS Spawn Triggers (Only if status updates succeeded) --- //
    if (ttsSpawnPromises.length > 0) {
      console.log(
        `[on-translation-complete] Executing ${ttsSpawnPromises.length} TTS spawn triggers for video ${dbVideoId}...`
      );
      const triggerResults = await Promise.allSettled(ttsSpawnPromises);
      const failedTriggers = triggerResults.filter(
        (r) => r.status === "rejected"
      );
      if (failedTriggers.length > 0) {
        console.error(
          `[on-translation-complete] ${failedTriggers.length} TTS spawn triggers FAILED for video ${dbVideoId}. Errors:`,
          failedTriggers.map((f: any) => f.reason?.message)
        );
        // The internalSpawnTtsJobs action is responsible for setting its target lang_voice key to 'failed'
        // if it encounters an error during spawning. So, we just log here.
        overallError = new Error(
          `Failed to execute ${failedTriggers.length} TTS spawn triggers.`
        );
      }
    } else if (processedTargetCount > 0) {
      // This case means we had targets that should have spawned TTS but didn't make it to ttsSpawnPromises
      // This shouldn't happen with current logic but is a safeguard.
      console.warn(
        `[on-translation-complete] Video ${dbVideoId}: Had ${processedTargetCount} targets identified for TTS, but no spawn jobs were queued. This might indicate an issue.`
      );
    } else {
      console.log(
        `[on-translation-complete] No TTS spawn triggers to execute for video ${dbVideoId}.`
      );
    }

    // --- Return Success or Partial Failure --- //
    if (overallError) {
      console.warn(
        `[on-translation-complete] Process completed with errors for video ${dbVideoId}.`
      );
      return new Response(
        JSON.stringify({
          message: "Translation processed, but TTS spawning failed.",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500, // Indicate server-side issues
        }
      );
    }

    // --- Return Success --- //
    console.log(
      `[on-translation-complete] Successfully processed translation update for video ${dbVideoId}.`
    );
    return new Response(
      JSON.stringify({ message: "Translation update processed" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error in on-translation-complete function:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
