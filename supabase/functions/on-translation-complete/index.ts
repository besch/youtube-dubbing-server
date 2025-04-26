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
    // Triggered when NEW.translations is distinct from OLD.translations
    if (
      payload.type !== "UPDATE" ||
      !payload.record.translations ||
      JSON.stringify(payload.record.translations) ===
        JSON.stringify(payload.old_record?.translations)
    ) {
      console.log(
        `[on-translation-complete] Ignoring update for segment ${payload.record.id} - Not a relevant translation update.`
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
    const updatedLanguages = Object.keys(newTranslations).filter(
      (lang) =>
        JSON.stringify(newTranslations[lang]) !==
        JSON.stringify(oldTranslations[lang])
    );

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
    let updateNeeded = false;
    for (const language of updatedLanguages) {
      const translatedContent = newTranslations[
        language
      ] as ReplicateSegmentOutput | null;

      if (
        !translatedContent ||
        !Array.isArray(translatedContent.segments) ||
        translatedContent.segments.length === 0
      ) {
        console.warn(
          `[on-translation-complete] Translation content for language ${language} in segment ${segmentId} is empty or invalid. Skipping TTS.`
        );
        continue;
      }

      // Find corresponding lang/voice combinations that were waiting for translation
      const targetProcesses = Object.keys(processingConfig).filter((key) => {
        const [lang, voice] = key.split("_");
        return (
          lang === language &&
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
          `[on-translation-complete] Processing target ${langVoiceKey} (status was 'translating_full'). Triggering audio generation.`
        );

        processingConfig[langVoiceKey] = {
          ...processingConfig[langVoiceKey],
          status: "generating_audio", // Update status first
          last_updated: new Date().toISOString(),
        };
        updateNeeded = true;

        // Trigger TTS spawning via the internal action
        console.log(
          `   -> Triggering internalSpawnTtsJobs for ${langVoiceKey}`
        );
        try {
          // Don't await, trigger in parallel
          triggerNextAction("internalSpawnTtsJobs", {
            videoId: dbVideoId,
            language: language,
            voice: voice,
          });
        } catch (spawnError) {
          console.error(
            `[on-translation-complete] Failed to trigger internalSpawnTtsJobs for ${langVoiceKey}: ${spawnError.message}. Continuing...`
          );
          // Optionally update status to failed here
          processingConfig[langVoiceKey].status = "failed";
          processingConfig[
            langVoiceKey
          ].error_message = `Failed to trigger TTS job spawning: ${spawnError.message}`;
        }
      }
    }

    // --- Update Video Processing Status in DB --- //
    if (updateNeeded) {
      console.log(
        "[on-translation-complete] Updating video processing_status in DB:",
        JSON.stringify(processingConfig)
      );
      const { error: updateError } = await supabaseAdmin
        .from("videos")
        .update({ processing_status: processingConfig })
        .eq("id", dbVideoId);

      if (updateError) {
        console.error(
          `[on-translation-complete] Error updating video processing status for ${dbVideoId}:`,
          updateError
        );
        throw new Error(
          "Failed to update video status after translation update."
        );
      }
    }

    // --- Return Success --- //
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
