import Replicate from "replicate";
import { AppError, AppErrorCode } from "@/app/actions/actions"; // Assuming actions.ts is in app/actions

// --- Environment Variable Checks ---
const REPLICATE_API_KEY = process.env.REPLICATE_API_KEY;
const REPLICATE_WEBHOOK_URL = process.env.REPLICATE_WEBHOOK_URL;

if (!REPLICATE_API_KEY) console.error("REPLICATE_API_KEY is not set.");
if (!REPLICATE_WEBHOOK_URL) console.error("REPLICATE_WEBHOOK_URL is not set.");

// --- Replicate Client Initialization ---
let replicate: Replicate | null = null;
if (REPLICATE_API_KEY) {
  replicate = new Replicate({
    auth: REPLICATE_API_KEY,
  });
} else {
  console.error(
    "Replicate client cannot be initialized without REPLICATE_API_KEY"
  );
}

// Define expected structure from transcription_segments.content
// **IMPORTANT**: Adjust these interfaces to match your actual Replicate model output
interface TranscriptionWord {
  start?: number; // Mark as optional if sometimes missing
  end?: number;
  word?: string;
  speaker?: string; // Optional: Include if your model provides it
}

export interface ReplicateSegment {
  start: number; // Assume these are present in valid segments
  end: number;
  text: string;
  words: TranscriptionWord[];
  speaker?: string; // Optional: Include if your model provides it
}

export interface ReplicateSegmentOutput {
  segments: ReplicateSegment[];
  detected_language?: string; // Optional: Include if provided and needed
}

// --- Helper: Start Replicate Transcription ---
export async function startReplicateTranscription(
  audioUrl: string
): Promise<string> {
  // Enhanced Log
  console.log(
    `Replicate: Audio URL starts with: ${audioUrl.substring(
      0,
      150
    )}... Webhook URL: ${REPLICATE_WEBHOOK_URL}`
  );
  if (!REPLICATE_WEBHOOK_URL) {
    // Added check
    console.error("Replicate Error: REPLICATE_WEBHOOK_URL is not set!");
    throw new AppError(
      AppErrorCode.CONFIGURATION_ERROR,
      "Replicate webhook URL is not configured."
    );
  }
  if (!replicate) {
    // Added check
    console.error("Replicate Error: Replicate client is not initialized!");
    throw new AppError(
      AppErrorCode.CONFIGURATION_ERROR,
      "Replicate client failed to initialize (check API key)." // Modified error message
    );
  }

  try {
    // Log inputs right before the call
    console.log(
      `Replicate: Calling replicate.predictions.create, webhook: ${REPLICATE_WEBHOOK_URL}`
    );
    const prediction = await replicate.predictions.create({
      version:
        "84d2ad2d6194fe98a17d2b60bef1c7f910c46b2f6fd38996ca457afd9c8abfcb",
      input: {
        audio_file: audioUrl,
        align_output: true,
        diarization: true,
      },
      webhook: REPLICATE_WEBHOOK_URL,
      webhook_events_filter: ["completed"], // Ensure this matches what webhook handler expects
    });

    if (!prediction?.id) {
      // Check prediction object itself as well
      console.error(
        "Replicate Error: API call succeeded but returned no prediction ID. Prediction object:",
        JSON.stringify(prediction, null, 2) // Log the full prediction object stringified
      );
      throw new Error("Replicate did not return a prediction ID");
    }
    console.log(
      "Replicate: Prediction started successfully. ID:",
      prediction.id
    ); // Log success
    return prediction.id;
  } catch (error: unknown) {
    // Log the raw error *before* wrapping it
    console.error(
      "Replicate Error: Caught error during predictions.create():",
      error // Log the actual error object
    );
    // Log details if it's an AxiosError or similar structure
    if (typeof error === "object" && error !== null && "response" in error) {
      const axiosError = error as {
        response?: { data?: any; status?: number; headers?: any };
      };
      console.error(
        "Replicate Error Response Data:",
        axiosError.response?.data
      );
      console.error(
        "Replicate Error Response Status:",
        axiosError.response?.status
      );
      console.error(
        "Replicate Error Response Headers:",
        axiosError.response?.headers
      );
    }

    // Construct a more informative message
    const message =
      error instanceof Error ? error.message : "Unknown Replicate API error";
    let detailedMessage = `Replicate transcription failed to start: ${message}`;
    // Attempt to extract more details if available (e.g., from Replicate's error structure)
    if (typeof error === "object" && error !== null && "toString" in error) {
      detailedMessage += ` | Details: ${error.toString()}`;
    }

    throw new AppError(
      AppErrorCode.REPLICATE_API_ERROR,
      detailedMessage // Use the more detailed message
    );
  }
}
