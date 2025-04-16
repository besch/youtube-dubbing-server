import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import { Buffer } from "buffer";
import { config } from "@/config";
import { AppError, AppErrorCode } from "@/app/actions/actions";

// --- Environment Variable Check --- //
// Check if the Google API Key is provided in the config
if (!config.apiKeys.googleApiKey) {
  console.error(
    "GOOGLE_API_KEY is not set in environment variables or config. " +
      "Google TTS cannot be initialized without an API key."
  );
  // Throw an error during initialization if the key is critical and missing
  // throw new Error("Missing GOOGLE_API_KEY for Text-to-Speech.");
}

// --- Google TTS Client Initialization --- //
let googleTtsClient: TextToSpeechClient | null = null;
try {
  if (config.apiKeys.googleApiKey) {
    // Initialize client using the API key
    googleTtsClient = new TextToSpeechClient({
      apiKey: config.apiKeys.googleApiKey,
    });
    console.log(
      "Google Text-to-Speech client initialized successfully using API Key."
    );
  } else {
    // This case should ideally not be reached if the check above is strict
    // or if the env var is guaranteed, but handle defensively.
    console.error(
      "Attempted to initialize Google TTS client without an API key."
    );
  }
} catch (error) {
  console.error("Failed to initialize Google Text-to-Speech client:", error);
  // Client remains null, functions using it will throw errors
}

// --- Types and Constants --- //

interface GenerateGoogleTtsParams {
  text: string;
  languageCode: string; // BCP-47 code (e.g., "en-US", "de-DE")
  voiceName: string; // Specific voice name (e.g., "en-US-Standard-A")
  videoId: string;
  startTime: number;
  endTime: number;
}

interface GenerateGoogleTtsResult {
  audioBuffer: Buffer;
  storagePath: string;
  fileName: string;
}

/**
 * Generates audio using Google Text-to-Speech.
 * @param params - Parameters for TTS generation.
 * @returns An object containing the audio buffer and the generated storage path.
 * @throws AppError if Google TTS client is not initialized or TTS fails.
 */
export async function generateGoogleTts({
  text,
  languageCode,
  voiceName,
  videoId,
  startTime,
  endTime,
}: GenerateGoogleTtsParams): Promise<GenerateGoogleTtsResult> {
  if (!googleTtsClient) {
    console.error(
      "Google TTS client is not initialized (missing API key or init failure)."
    );
    throw new AppError(
      AppErrorCode.CONFIGURATION_ERROR,
      "Google TTS client is not available. Check API Key and initialization logs."
    );
  }

  if (!text) {
    throw new AppError(
      AppErrorCode.INVALID_INPUT,
      "Google TTS input text cannot be empty."
    );
  }

  // Basic validation of language code and voice name format (more robust validation happens in action)
  if (!languageCode || !voiceName) {
    throw new AppError(
      AppErrorCode.INVALID_INPUT,
      `Invalid Google TTS language code (${languageCode}) or voice name (${voiceName}).`
    );
  }

  console.log(
    `Google TTS: Generating for ${videoId}, Lang: ${languageCode}, Voice: ${voiceName}, Time: ${startTime}-${endTime}`
  );
  console.log(
    `Google TTS: Input text (first 100 chars): "${text.substring(0, 100)}..."`
  );

  try {
    const request = {
      input: { text: text },
      voice: { languageCode: languageCode, name: voiceName },
      // Explicitly set the audio encoding format
      audioConfig: {
        audioEncoding: "MP3" as const, // Use const assertion for type safety
        speakingRate: config.google.defaultSpeakingRate, // Use configured speaking rate
      },
    };

    const [response] = await googleTtsClient.synthesizeSpeech(request);

    if (!response.audioContent) {
      throw new Error("Google TTS failed: No audio content received");
    }

    // Ensure audioContent is treated as Buffer
    let audioBuffer: Buffer;
    if (typeof response.audioContent === "string") {
      audioBuffer = Buffer.from(response.audioContent, "base64");
    } else if (response.audioContent instanceof Uint8Array) {
      audioBuffer = Buffer.from(response.audioContent);
    } else {
      // Should not happen based on documentation, but handle defensively
      throw new Error("Google TTS returned unexpected audio content type");
    }

    // Generate a consistent filename (similar to OpenAI)
    // Using BCP-47 language code and full voice name for uniqueness
    const simpleLangCode =
      Object.entries(config.google.simpleToGoogleMap).find(
        ([_, googleCode]) => googleCode === languageCode
      )?.[0] || languageCode;
    const fileName = `${videoId}_${simpleLangCode}_${voiceName}_${startTime.toFixed(
      2
    )}_${endTime.toFixed(2)}.mp3`;
    const storagePath = `${videoId}/${simpleLangCode}/${fileName}`; // Use simple lang code for path consistency

    console.log(`Google TTS: Generated audio buffer, path: ${storagePath}`);

    return { audioBuffer, storagePath, fileName };
  } catch (error: unknown) {
    console.error("Google TTS API Error:", error);
    const message =
      error instanceof Error ? error.message : "Unknown Google TTS error";
    throw new AppError(
      AppErrorCode.SERVICE_ERROR,
      `Google TTS failed: ${message}`
    );
  }
}
