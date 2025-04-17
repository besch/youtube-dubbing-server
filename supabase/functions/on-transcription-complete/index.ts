import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../utils/cors.ts";

// Define types for the incoming webhook payload
interface TranscriptionSegmentPayload {
  type: "UPDATE"; // Or potentially 'INSERT' if using a direct webhook
  table: "transcription_segments";
  record: {
    id: string;
    video_id: string;
    start_time: number;
    end_time: number;
    status: "pending" | "processing" | "completed" | "failed";
    content: Record<string, any> | null; // Adjust content type as needed
    translations: Record<string, any> | null; // JSONB column
    error_message: string | null;
  };
  old_record: {
    status?: "pending" | "processing" | "completed" | "failed";
    translations?: Record<string, any> | null;
  } | null;
}

const NEXTJS_API_URL = Deno.env.get("NEXTJS_API_URL");
const FUNCTION_SECRET = Deno.env.get("FUNCTION_SECRET");

// Helper function to call the internal Next.js action trigger
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

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(
      `Error calling action '${actionName}': ${response.status} ${response.statusText}`,
      errorBody
    );
    // Decide if the function should throw or just log the error
    throw new Error(
      `Failed to trigger action '${actionName}': ${response.status} ${errorBody}`
    );
  }

  const result = await response.json();
  console.log(`Action '${actionName}' trigger response:`, result);
  return result;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload: TranscriptionSegmentPayload = await req.json();

    // --- Validation ---
    // We care about segments becoming 'completed' or translations being added
    const isCompletion =
      payload.type === "UPDATE" &&
      payload.record.status === "completed" &&
      payload.old_record?.status !== "completed";

    const hasNewTranslation =
      payload.type === "UPDATE" &&
      payload.record.translations &&
      JSON.stringify(payload.record.translations) !==
        JSON.stringify(payload.old_record?.translations);

    if (!isCompletion && !hasNewTranslation) {
      console.log(
        "Ignoring irrelevant transcription update:",
        payload.record.id
      );
      return new Response(JSON.stringify({ message: "Irrelevant update" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const {
      id: segmentId,
      video_id: dbVideoId,
      start_time: segmentStartTime,
      end_time: segmentEndTime,
    } = payload.record;
    console.log(
      `Processing update for segment ${segmentId} (Video: ${dbVideoId}) - Completion: ${isCompletion}, New Translation: ${hasNewTranslation}`
    );

    // --- Supabase Client ---
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

    // --- Fetch Video Details (Duration & Target Processes) ---
    const { data: videoData, error: videoError } = await supabaseAdmin
      .from("videos")
      .select("duration, processing_status") // Need processing_status to know which lang/voice combos are active
      .eq("id", dbVideoId)
      .single();

    if (videoError || !videoData || !videoData.duration) {
      console.error(
        `Error fetching video details for ${dbVideoId}:`,
        videoError
      );
      throw new Error(
        `Failed to fetch video details or duration for ${dbVideoId}`
      );
    }

    const processingConfig = videoData.processing_status || {};
    const videoDuration = videoData.duration;
    const targetProcesses = Object.keys(processingConfig).filter(
      (key) =>
        processingConfig[key]?.status !== "completed" &&
        processingConfig[key]?.status !== "failed"
    );

    if (targetProcesses.length === 0) {
      console.log(
        `No active processes found for video ${dbVideoId}. Skipping further actions for segment ${segmentId}.`
      );
      return new Response(JSON.stringify({ message: "No active processes" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // --- Logic for Each Target Process (Language/Voice) ---
    for (const langVoiceKey of targetProcesses) {
      const [language, voice] = langVoiceKey.split("_"); // Assumes format "lang_voice"
      const needsTranslation = language !== "en"; // Assuming 'en' is the source

      // Update Status (Example - refine this)
      // const currentProcessStatus = processingConfig[langVoiceKey]?.status;
      // ... logic to update processingConfig[langVoiceKey].status based on event ...
      // Example: processingConfig[langVoiceKey].status = needsTranslation ? 'translating' : 'generating_audio';

      // A) Handle Completed Transcription Segment
      if (isCompletion) {
        if (needsTranslation) {
          // Trigger Translation
          await triggerNextAction("translateSegmentContent", {
            segmentId,
            targetLanguage: language,
          });
          // Update status to 'translating'
          processingConfig[langVoiceKey].status = "translating";
        } else {
          // Trigger Audio Generation (using original content)
          await triggerNextAction("generateAudioChunk", {
            videoId: dbVideoId,
            language: language,
            voice: voice,
            startTime: segmentStartTime, // Needs the actual start/end of the sentences within the segment
            endTime: segmentEndTime,
            // segmentId: segmentId // Pass segmentId to fetch original content
          });
          // Update status to 'generating_audio'
          processingConfig[langVoiceKey].status = "generating_audio";
        }
      }

      // B) Handle Newly Available Translation (for the target language of this process)
      if (hasNewTranslation && payload.record.translations?.[language]) {
        // Trigger Audio Generation (using translated content)
        await triggerNextAction("generateAudioChunk", {
          videoId: dbVideoId,
          language: language,
          voice: voice,
          startTime: segmentStartTime, // Needs the actual start/end of the sentences within the segment
          endTime: segmentEndTime,
          // segmentId: segmentId // Pass segmentId and language to fetch translated content
        });
        // Update status to 'generating_audio'
        processingConfig[langVoiceKey].status = "generating_audio";
      }
    }

    // --- Update Video Processing Status in DB ---
    const { error: updateError } = await supabaseAdmin
      .from("videos")
      .update({ processing_status: processingConfig })
      .eq("id", dbVideoId);

    if (updateError) {
      console.error(
        `Error updating video processing status for ${dbVideoId} after segment ${segmentId} update:`,
        updateError
      );
      // Potentially throw, but maybe just log
    }

    // --- Trigger Next Transcription Segment (if applicable and completion event) ---
    if (isCompletion && segmentEndTime < videoDuration) {
      const SEGMENT_DURATION = 180;
      const nextStartTime = segmentEndTime;
      const nextEndTime = Math.min(
        nextStartTime + SEGMENT_DURATION,
        videoDuration
      );

      if (nextStartTime < nextEndTime) {
        await triggerNextAction("requestTranscriptionSegment", {
          videoId: dbVideoId,
          startTime: nextStartTime,
          endTime: nextEndTime,
        });
      }
    }

    // --- Return Success ---
    return new Response(
      JSON.stringify({ message: "Segment update processed" }),
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
