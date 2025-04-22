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

    if (!isCompletion) {
      console.log(
        `[on-transcription-complete] Ignoring update for segment ${payload.record.id} - Not a completion event.`
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
        `Failed to fetch video details for ${dbVideoId} after transcription completion.`
      );
    }

    const processingConfig = (videoData.processing_status ||
      {}) as VideoProcessingStatus;
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

    if (
      !fullTranscriptionContent ||
      !Array.isArray(fullTranscriptionContent.segments) ||
      fullTranscriptionContent.segments.length === 0
    ) {
      console.error(
        `[on-transcription-complete] Completed transcription for ${dbVideoId} (Segment ID: ${segmentId}) has no valid content. Marking targets as failed.`
      );
      // Mark relevant processes as failed
      for (const langVoiceKey of targetProcesses) {
        processingConfig[langVoiceKey] = {
          ...processingConfig[langVoiceKey],
          status: "failed",
          error_message:
            "Transcription completed but content was empty/invalid.",
          last_updated: new Date().toISOString(),
        };
      }
      await supabaseAdmin
        .from("videos")
        .update({ processing_status: processingConfig })
        .eq("id", dbVideoId);
      throw new Error("Transcription content missing or invalid.");
    }

    // --- Logic for Each Target Process (Language/Voice) --- //
    let updateNeeded = false;
    for (const langVoiceKey of targetProcesses) {
      const [language, voice] = langVoiceKey.split("_");
      console.log(
        `[on-transcription-complete] Processing target: ${langVoiceKey}`
      );

      if (language === "en") {
        // --- English: Trigger Audio Generation directly --- //
        console.log(
          `[on-transcription-complete] Target ${langVoiceKey} is English. Triggering audio generation.`
        );
        processingConfig[langVoiceKey] = {
          ...processingConfig[langVoiceKey],
          status: "generating_audio", // Update status first
          last_updated: new Date().toISOString(),
        };
        updateNeeded = true;

        for (const subSegment of fullTranscriptionContent.segments) {
          if (
            subSegment.start !== undefined &&
            subSegment.end !== undefined &&
            subSegment.text?.trim() // Ensure there is text to synthesize
          ) {
            console.log(
              `   -> Triggering TTS for EN sub-segment ${subSegment.start}-${subSegment.end}`
            );
            try {
              // Don't await these individually, let them run in parallel
              triggerNextAction("internalGenerateAudioChunk", {
                videoId: dbVideoId,
                language: language, // "en"
                voice: voice,
                startTime: subSegment.start,
                endTime: subSegment.end,
              });
            } catch (ttsError) {
              console.error(
                `[on-transcription-complete] Failed to trigger TTS for ${langVoiceKey}, segment ${subSegment.start}-${subSegment.end}: ${ttsError.message}. Continuing...`
              );
              // Optionally mark this specific target as failed?
              // processingConfig[langVoiceKey].status = "failed";
              // processingConfig[langVoiceKey].error_message = `TTS trigger failed for segment ${subSegment.start}-${subSegment.end}`;
            }
          } else {
            console.warn(
              `[on-transcription-complete] Skipping EN sub-segment due to missing start/end/text:`,
              subSegment
            );
          }
        }
      } else {
        // --- Non-English: Trigger Full Translation --- //
        console.log(
          `[on-transcription-complete] Target ${langVoiceKey} requires translation. Triggering full translation to ${language}.`
        );
        processingConfig[langVoiceKey] = {
          ...processingConfig[langVoiceKey],
          status: "translating_full", // Update status first
          last_updated: new Date().toISOString(),
        };
        updateNeeded = true;

        try {
          // Trigger translation for the entire content
          await triggerNextAction("internalTranslateFullContent", {
            segmentId: segmentId, // Pass the ID of the transcription_segments row
            targetLanguage: language,
          });
        } catch (translateError) {
          console.error(
            `[on-transcription-complete] Failed to trigger translation for ${langVoiceKey}: ${translateError.message}. Marking as failed.`
          );
          // Mark this target as failed if triggering fails
          processingConfig[langVoiceKey].status = "failed";
          processingConfig[
            langVoiceKey
          ].error_message = `Failed to trigger translation: ${translateError.message}`;
        }
      }
    }

    // --- Update Video Processing Status in DB --- //
    if (updateNeeded) {
      console.log(
        "[on-transcription-complete] Updating video processing_status in DB:",
        JSON.stringify(processingConfig)
      );
      const { error: updateError } = await supabaseAdmin
        .from("videos")
        .update({ processing_status: processingConfig })
        .eq("id", dbVideoId);

      if (updateError) {
        console.error(
          `[on-transcription-complete] Error updating video processing status for ${dbVideoId}:`,
          updateError
        );
        // Throw error here as subsequent steps depend on correct status
        throw new Error(
          "Failed to update video status after transcription completion."
        );
      }
    }

    // --- Return Success --- //
    return new Response(
      JSON.stringify({ message: "Transcription processed" }),
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
