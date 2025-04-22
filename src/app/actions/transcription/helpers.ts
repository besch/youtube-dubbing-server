"use server";

import { AppError, AppErrorCode } from "../actions";

const AUDIO_SEGMENTER_URL = process.env.AUDIO_SEGMENTER_URL;
const AUDIO_SEGMENTER_SECRET_KEY = process.env.AUDIO_SEGMENTER_SECRET_KEY;

// Check if environment variables are set during module load
if (!AUDIO_SEGMENTER_URL) {
  console.error(
    "Configuration Error: AUDIO_SEGMENTER_URL is not set in environment variables."
  );
}
if (!AUDIO_SEGMENTER_SECRET_KEY) {
  console.error(
    "Configuration Error: AUDIO_SEGMENTER_SECRET_KEY is not set in environment variables."
  );
}

// --- Helper: Call Audio Segmenter Microservice ---
export async function getAudioSegmentPath(
  videoId: string,
  startTime: number,
  endTime: number
): Promise<string> {
  // Check again inside the function in case checks at load time are bypassed
  if (!AUDIO_SEGMENTER_URL || !AUDIO_SEGMENTER_SECRET_KEY) {
    console.error("Audio Segmenter URL or Secret Key not configured!");
    throw new AppError(
      AppErrorCode.CONFIGURATION_ERROR,
      "Audio Segmenter service is not configured on the server."
    );
  }

  // Workaround for segmenter validation: send a tiny positive value if startTime is 0
  const segmenterStartTime = startTime === 0 ? 0.01 : startTime;

  console.log(
    `Calling Audio Segmenter at ${AUDIO_SEGMENTER_URL} for video ${videoId} (Sent Time: ${segmenterStartTime}-${endTime}, Original Start: ${startTime})`
  );
  try {
    const response = await fetch(`${AUDIO_SEGMENTER_URL}/segment-transcribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": AUDIO_SEGMENTER_SECRET_KEY,
      },
      body: JSON.stringify({
        video_id: videoId,
        start_time: segmenterStartTime, // Use the adjusted start time here
        end_time: endTime,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Audio Segmenter Error (${response.status}): ${errorBody}`);
      let detailMessage = `Status ${response.status}: ${errorBody}`; // Default message
      try {
        const parsedError = JSON.parse(errorBody);
        if (typeof parsedError.detail === "string") {
          detailMessage = parsedError.detail;
        } else {
          detailMessage = JSON.stringify(parsedError);
        }
      } catch {
        // Parsing failed, stick with the raw errorBody
      }
      throw new AppError(
        AppErrorCode.AUDIO_SEGMENTER_ERROR,
        `Audio Segmenter failed: ${detailMessage}`
      );
    }

    const data = await response.json();
    if (!data.segment_storage_path) {
      console.error(
        "Audio Segmenter response missing segment_storage_path:",
        data
      );
      throw new AppError(
        AppErrorCode.SERVICE_ERROR,
        "Audio Segmenter did not return segment path"
      );
    }
    console.log(`Audio Segmenter returned path: ${data.segment_storage_path}`);
    return data.segment_storage_path;
  } catch (error: unknown) {
    console.error("Error calling Audio Segmenter:", error);
    if (error instanceof AppError) throw error;
    const message =
      error instanceof Error ? error.message : "Unknown communication error";
    throw new AppError(
      AppErrorCode.SERVICE_ERROR,
      `Failed to communicate with Audio Segmenter: ${message}`
    );
  }
}
