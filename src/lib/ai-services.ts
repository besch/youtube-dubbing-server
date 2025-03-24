import Replicate from "replicate";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import { PassThrough } from "stream";
import { config } from "@/config";
import { TranscriptionSegment, Voice } from "@/types";
import { appErrors } from "@/types/actions";
import { createAdminClient } from "./supabase";
import { createHash } from "crypto";
import { randomUUID } from "crypto";

// Set up clients
const replicate = new Replicate({
  auth: config.replicate.apiKey,
});

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

// Initialize Anthropic client for translations
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Azure TTS setup (not used by default but available if needed)
const azureSpeechKey = process.env.AZURE_SPEECH_KEY;
const azureSpeechRegion = process.env.AZURE_SPEECH_REGION;

// Transcribe and diarize audio using Replicate
export async function transcribeAudio(
  audioPath: string,
  language = "en",
  numSpeakers = 2
): Promise<TranscriptionSegment[]> {
  try {
    // Read audio file as base64
    const audioBuffer = await fs.promises.readFile(audioPath);
    const base64Audio = audioBuffer.toString("base64");

    // Call Replicate API
    const output = await replicate.run(
      "thomasmol/whisper-diarization:d8bc5908738ebd84a9bb7d77d94b9c5e5a3d867886791d7171ddb60455b4c6af",
      {
        input: {
          file: `data:audio/mp3;base64,${base64Audio}`,
          language,
          translate: false,
          num_speakers: numSpeakers,
        },
      }
    );

    return output as TranscriptionSegment[];
  } catch (error) {
    console.error("Error transcribing audio:", error);
    throw appErrors.TRANSCRIPTION_ERROR;
  }
}

// Translate text using Anthropic's Claude API
export async function translateText(
  text: string,
  sourceLanguage: string,
  targetLanguage: string
): Promise<string> {
  try {
    // Get language names instead of codes
    const sourceLangName = getLanguageName(sourceLanguage);
    const targetLangName = getLanguageName(targetLanguage);

    const response = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: `Translate the following text from ${sourceLangName} to ${targetLangName}. 
            Maintain the natural flow and meaning of the original text.
            Preserve any speaker indicators or contextual information.
            Keep the translation concise and suitable for voice dubbing.
            
            ${text}`,
        },
      ],
      temperature: 0.3,
    });

    // Extract the text content from response
    if (
      response.content &&
      response.content.length > 0 &&
      "text" in response.content[0]
    ) {
      return response.content[0].text;
    }

    throw new Error("Invalid response format from translation API");
  } catch (error) {
    console.error("Error translating text:", error);
    throw appErrors.TRANSLATION_ERROR;
  }
}

// Helper to get language name from code
function getLanguageName(code: string): string {
  const languages: Record<string, string> = {
    en: "English",
    es: "Spanish",
    fr: "French",
    de: "German",
    it: "Italian",
    pt: "Portuguese",
    ru: "Russian",
    ja: "Japanese",
    zh: "Chinese",
    ko: "Korean",
    ar: "Arabic",
    pl: "Polish",
    // Add more languages as needed
  };

  return languages[code] || code;
}

// Generate speech using OpenAI TTS
export async function generateSpeech(
  text: string,
  voice: Voice,
  outputPath: string
): Promise<void> {
  try {
    const mp3 = await openai.audio.speech.create({
      model: "tts-1",
      voice,
      input: text,
    });

    // Convert to buffer and save to disk
    const buffer = Buffer.from(await mp3.arrayBuffer());
    await fs.promises.writeFile(outputPath, buffer);
  } catch (error) {
    console.error("Error generating speech:", error);
    throw appErrors.TTS_ERROR;
  }
}

// Generate speech and upload to Supabase
export async function generateAndUploadSpeech(
  text: string,
  voice: Voice,
  videoId: string,
  language: string,
  startTime: number,
  endTime: number,
  isFavorite: boolean = false
): Promise<string> {
  try {
    // Generate a unique filename
    const hash = createHash("md5")
      .update(`${videoId}-${language}-${voice}-${startTime}-${endTime}`)
      .digest("hex");
    const filename = `${hash}.mp3`;
    const storagePath = `${videoId}/${language}/${voice}/${filename}`;

    // Generate a temporary path to store the audio
    const tempFilePath = `/tmp/${randomUUID()}.mp3`;

    // Generate the speech
    await generateSpeech(text, voice, tempFilePath);

    // Upload to Supabase storage
    const supabase = createAdminClient();
    const audioFile = await fs.promises.readFile(tempFilePath);

    const { error } = await supabase.storage
      .from("audio_chunks")
      .upload(storagePath, audioFile, {
        contentType: "audio/mpeg",
        cacheControl: "3600",
        upsert: true,
      });

    if (error) {
      console.error("Error uploading to storage:", error);
      throw appErrors.STORAGE_ERROR;
    }

    // Get the expiry date based on favorite status
    const expiryAt = new Date();
    if (isFavorite) {
      expiryAt.setDate(expiryAt.getDate() + 30); // 30 days
    } else {
      expiryAt.setDate(expiryAt.getDate() + 1); // 24 hours
    }

    // Add entry to audio_chunks table
    const { error: dbError } = await supabase.from("audio_chunks").insert({
      video_id: videoId,
      language,
      voice,
      start_time: startTime,
      end_time: endTime,
      storage_path: storagePath,
      expiry_at: expiryAt.toISOString(),
      is_favorite: isFavorite,
    });

    if (dbError) {
      console.error("Error inserting into audio_chunks:", dbError);
      throw appErrors.DATABASE_ERROR;
    }

    // Clean up the temp file
    await fs.promises.unlink(tempFilePath);

    // Return the storage path
    return storagePath;
  } catch (error) {
    console.error("Error in generateAndUploadSpeech:", error);
    if (
      error === appErrors.TTS_ERROR ||
      error === appErrors.STORAGE_ERROR ||
      error === appErrors.DATABASE_ERROR
    ) {
      throw error;
    }
    throw appErrors.UNEXPECTED_ERROR;
  }
}
