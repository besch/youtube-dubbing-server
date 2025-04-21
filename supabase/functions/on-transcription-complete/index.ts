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
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let requestPayload;
  try {
    // Log raw request body first
    const rawBody = await req.text();
    console.log("[on-transcription-complete] Raw Request Body:", rawBody);
    requestPayload = JSON.parse(rawBody);
    console.log(
      "[on-transcription-complete] Parsed Payload:",
      JSON.stringify(requestPayload, null, 2)
    );

    const payload: TranscriptionSegmentPayload = requestPayload; // Assign after logging

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
      const [language, voice] = langVoiceKey.split("_");
      const needsTranslation = language !== "en";
      const currentStatus = processingConfig[langVoiceKey]?.status;
      console.log(
        `[on-transcription-complete] Processing target: ${langVoiceKey}, Current Status: ${currentStatus}, Needs Translation: ${needsTranslation}`
      ); // Log status per target

      // Check 1: Did the segment just get completed?
      if (isCompletion) {
        if (needsTranslation) {
          // Trigger Translation only if needed and not already started/done
          if (
            !payload.record.translations?.[language] &&
            currentStatus !== "translating" &&
            currentStatus !== "generating_audio" &&
            currentStatus !== "completed" &&
            currentStatus !== "failed"
          ) {
            console.log(
              `Segment ${segmentId} completed, status is '${currentStatus}', triggering translation to ${language}`
            );
            await triggerNextAction("internalTranslateSegmentContent", {
              segmentId,
              targetLanguage: language,
            });
            processingConfig[langVoiceKey].status = "translating";
          } else {
            // Translation already exists or process is further along, check if audio needs triggering
            if (
              payload.record.translations?.[language] && // Check if translation exists now
              currentStatus !== "generating_audio" &&
              currentStatus !== "completed" &&
              currentStatus !== "failed"
            ) {
              console.log(
                `Segment ${segmentId} completed, translation ${language} exists (or process advanced), status '${currentStatus}', triggering audio generation`
              );
              // --- Modification Start: Iterate through translated segments ---
              const translatedContent = payload.record.translations?.[language];
              if (
                translatedContent?.segments &&
                Array.isArray(translatedContent.segments)
              ) {
                processingConfig[langVoiceKey].status = "generating_audio"; // Set status before looping
                for (const subSegment of translatedContent.segments) {
                  if (
                    subSegment.start !== undefined &&
                    subSegment.end !== undefined
                  ) {
                    console.log(
                      `   -> Triggering TTS for sub-segment ${subSegment.start}-${subSegment.end}`
                    );
                    await triggerNextAction("internalGenerateAudioChunk", {
                      videoId: dbVideoId,
                      language: language,
                      voice: voice,
                      startTime: subSegment.start,
                      endTime: subSegment.end,
                    });
                  } else {
                    console.warn(
                      `Skipping sub-segment in ${segmentId} due to missing start/end:`,
                      subSegment
                    );
                  }
                }
              } else {
                console.error(
                  `Could not find valid translated segments array for ${segmentId}, lang ${language}`
                );
              }
              // --- Modification End ---
            }
          }
        } else {
          // English: Trigger Audio Generation directly upon segment completion if not already done
          if (
            currentStatus !== "generating_audio" &&
            currentStatus !== "completed" &&
            currentStatus !== "failed"
          ) {
            console.log(
              `Segment ${segmentId} completed (EN), status '${currentStatus}', triggering audio generation`
            );
            // --- Modification Start: Iterate through original segments ---
            const originalContent = payload.record.content;
            if (
              originalContent?.segments &&
              Array.isArray(originalContent.segments)
            ) {
              processingConfig[langVoiceKey].status = "generating_audio"; // Set status before looping
              for (const subSegment of originalContent.segments) {
                if (
                  subSegment.start !== undefined &&
                  subSegment.end !== undefined
                ) {
                  console.log(
                    `   -> Triggering TTS for sub-segment ${subSegment.start}-${subSegment.end}`
                  );
                  await triggerNextAction("internalGenerateAudioChunk", {
                    videoId: dbVideoId,
                    language: language, // "en"
                    voice: voice,
                    startTime: subSegment.start,
                    endTime: subSegment.end,
                  });
                } else {
                  console.warn(
                    `Skipping sub-segment in ${segmentId} due to missing start/end:`,
                    subSegment
                  );
                }
              }
            } else {
              console.error(
                `Could not find valid original segments array for ${segmentId}`
              );
            }
            // --- Modification End ---
          }
        }
      }
      // Check 2: Was a translation just added for our target language?
      else if (
        hasNewTranslation &&
        payload.record.translations?.[language] && // Translation for *our* target lang is now present
        currentStatus === "translating" // Ensure we only trigger if we were waiting for translation
      ) {
        console.log(
          `[on-transcription-complete] Entering 'hasNewTranslation' block for ${langVoiceKey}. Current Status: ${currentStatus}`
        );
        console.log(
          `Translation ${language} added for segment ${segmentId}, status was 'translating', triggering audio generation`
        );
        // --- Modification Start: Iterate through newly translated segments ---
        const translatedContent = payload.record.translations?.[language];
        if (
          translatedContent?.segments &&
          Array.isArray(translatedContent.segments)
        ) {
          processingConfig[langVoiceKey].status = "generating_audio"; // Update status before looping
          for (const subSegment of translatedContent.segments) {
            if (
              subSegment.start !== undefined &&
              subSegment.end !== undefined
            ) {
              console.log(
                `   -> Triggering TTS for sub-segment ${subSegment.start}-${subSegment.end}`
              );
              await triggerNextAction("internalGenerateAudioChunk", {
                videoId: dbVideoId,
                language: language,
                voice: voice,
                startTime: subSegment.start,
                endTime: subSegment.end,
              });
            } else {
              console.warn(
                `Skipping sub-segment in ${segmentId} due to missing start/end:`,
                subSegment
              );
            }
          }
        } else {
          console.error(
            `Could not find valid translated segments array for ${segmentId}, lang ${language} (after translation update)`
          );
        }
        // --- Modification End ---
      }
    }

    // --- Update Video Processing Status in DB --- (Ensure this happens AFTER loop)
    console.log(
      "Final processing status before DB update:",
      JSON.stringify(processingConfig)
    );
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
        await triggerNextAction("internalRequestTranscriptionSegment", {
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
