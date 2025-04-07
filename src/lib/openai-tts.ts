import { OpenAI } from "openai";
import { Buffer } from "buffer";
import { AppError, AppErrorCode } from "@/app/actions/actions";

// --- Environment Variable Check ---
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is not set for TTS generation.");
  // Optionally throw an error during initialization if critical
  // throw new Error("OPENAI_API_KEY is required for TTS functionality.");
}

// --- OpenAI Client Initialization ---
// Initialize OpenAI client only if the key is available
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// --- Types and Constants ---
export type OpenAiTtsVoice =
  | "alloy"
  | "echo"
  | "fable"
  | "onyx"
  | "nova"
  | "shimmer";
export const VALID_TTS_VOICES: Set<OpenAiTtsVoice> = new Set([
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
]);

interface GenerateTtsParams {
  text: string;
  voice: OpenAiTtsVoice;
  videoId: string;
  language: string;
  startTime: number;
  endTime: number;
}

interface GenerateTtsResult {
  audioBuffer: Buffer;
  storagePath: string;
  fileName: string;
}

/**
 * Generates audio using OpenAI TTS.
 * @param params - Parameters for TTS generation.
 * @returns An object containing the audio buffer and the generated storage path.
 * @throws AppError if OpenAI client is not initialized or TTS fails.
 */
export async function generateOpenAiTts({
  text,
  voice,
  videoId,
  language,
  startTime,
  endTime,
}: GenerateTtsParams): Promise<GenerateTtsResult> {
  if (!openai) {
    console.error("OpenAI client not initialized due to missing API key.");
    throw new AppError(
      AppErrorCode.CONFIGURATION_ERROR,
      "OpenAI API key not configured for TTS."
    );
  }

  if (!text) {
    throw new AppError(
      AppErrorCode.INVALID_INPUT,
      "TTS input text cannot be empty."
    );
  }
  if (!VALID_TTS_VOICES.has(voice)) {
    throw new AppError(
      AppErrorCode.INVALID_INPUT,
      `Invalid TTS voice: ${voice}`
    );
  }

  console.log(
    `OpenAI TTS: Generating for ${videoId}, Lang: ${language}, Voice: ${voice}, Time: ${startTime}-${endTime}`
  );
  console.log(
    `OpenAI TTS: Input text (first 100 chars): "${text.substring(0, 100)}..."`
  );

  try {
    const ttsResponse = await openai.audio.speech.create({
      model: "tts-1", // Or "tts-1-hd" if preferred
      voice: voice,
      input: text,
      response_format: "mp3", // Ensure format is supported by player/storage
    });

    if (!ttsResponse.body) {
      throw new Error("OpenAI TTS failed: No response body");
    }

    const audioBuffer = Buffer.from(await ttsResponse.arrayBuffer());

    // Generate a consistent filename
    const fileName = `${videoId}_${language}_${voice}_${startTime.toFixed(
      2
    )}_${endTime.toFixed(2)}.mp3`;
    const storagePath = `${videoId}/${language}/${fileName}`; // Define storage path structure

    console.log(`OpenAI TTS: Generated audio buffer, path: ${storagePath}`);

    return { audioBuffer, storagePath, fileName };
  } catch (error: unknown) {
    console.error("OpenAI TTS Error:", error);
    const message =
      error instanceof Error ? error.message : "Unknown TTS error";
    // Use a specific error code if applicable, otherwise use SERVICE_ERROR
    throw new AppError(
      AppErrorCode.SERVICE_ERROR,
      `OpenAI TTS failed: ${message}`
    );
  }
}
