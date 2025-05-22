"use server";

import { z } from "zod";
import { createSafeActionClient } from "next-safe-action";
import { ActionResponse, AppError, AppErrorCode } from "../actions";
import { config } from "@/config";
import { generateOpenAiTts } from "@/lib/openai-tts";
import { generateGoogleTts } from "@/lib/google-tts";

// --- Action: Generate Audio Chunk (Revised for Multi-TTS and On-the-Fly) ---
const generateAudioSchema = z
  .object({
    language: z.string(),
    voice: z.string(),
    startTime: z.number().min(0),
    endTime: z.number().min(0),
    text: z.string().min(1, { message: "Text cannot be empty" }),
  })
  .refine((data) => data.endTime > data.startTime, {
    message: "End time must be greater than start time",
    path: ["endTime"],
  });

// Define input type from schema
type GenerateAudioChunkInput = z.infer<typeof generateAudioSchema>;

export const generateAudioChunk = createSafeActionClient()(
  generateAudioSchema,
  async ({
    language,
    voice,
    startTime,
    endTime,
    text,
  }: GenerateAudioChunkInput): Promise<
    ActionResponse<{ audioBase64: string; mimeType: string }>
  > => {
    let textToSynthesize: string = text.trim();

    let ttsProvider: "openai" | "google" | null = null;
    let googleLangCode: string | undefined;
    let googleVoiceName: string | undefined;
    let openaiVoiceName: string | undefined;

    const targetGoogleLangCode = config.google.simpleToGoogleMap[language];
    if (targetGoogleLangCode && config.google.languages[targetGoogleLangCode]) {
      const validGoogleVoices =
        config.google.languages[targetGoogleLangCode].voices;
      if (validGoogleVoices.some((v) => v.id === voice)) {
        ttsProvider = "google";
        googleLangCode = targetGoogleLangCode;
        googleVoiceName = voice;
      }
    }
    if (ttsProvider === null) {
      if (config.openai.voices.includes(voice)) {
        ttsProvider = "openai";
        openaiVoiceName = voice;
      } else {
        let errorMessage = `Voice '${voice}' is not a valid OpenAI voice.`;
        if (
          targetGoogleLangCode &&
          config.google.languages[targetGoogleLangCode]
        ) {
          const validGoogleVoicesList = config.google.languages[
            targetGoogleLangCode
          ].voices
            .map((v) => v.id)
            .join(", ");
          errorMessage += ` It's also not a valid Google voice for language '${language}'. Valid Google voices: ${validGoogleVoicesList}`;
        } else {
          errorMessage += ` Language '${language}' is also not supported by Google TTS.`;
        }
        return {
          success: false,
          error: new AppError(AppErrorCode.INVALID_INPUT, errorMessage),
        };
      }
    }
    if (!ttsProvider) {
      return {
        success: false,
        error: new AppError(
          AppErrorCode.UNEXPECTED_ERROR,
          `Failed to determine TTS provider for language '${language}' and voice '${voice}'.`
        ),
      };
    }

    try {
      console.log(
        `Direct TTS generation for Lang: ${language}, Voice: ${voice}. Text: "${textToSynthesize.substring(
          0,
          100
        )}..."`
      );

      if (!textToSynthesize) {
        return {
          success: false,
          error: new AppError(
            AppErrorCode.INVALID_INPUT,
            `No text provided for TTS.`
          ),
        };
      }

      let ttsResult: { audioBuffer: Buffer };

      if (ttsProvider === "google") {
        ttsResult = await generateGoogleTts({
          text: textToSynthesize,
          languageCode: googleLangCode!,
          voiceName: googleVoiceName!,
          startTime,
          endTime,
        });
      } else {
        ttsResult = await generateOpenAiTts({
          text: textToSynthesize,
          voice: openaiVoiceName as any,
          language,
          startTime,
          endTime,
        });
      }

      const { audioBuffer } = ttsResult;
      const audioBase64 = audioBuffer.toString("base64");
      const mimeType = "audio/mpeg";

      console.log(`TTS generation successful. Returning base64 audio.`);
      return { success: true, data: { audioBase64, mimeType } };
    } catch (error: unknown) {
      console.error("Error generating audio chunk:", error);
      const appErr =
        error instanceof AppError
          ? error
          : new AppError(
              AppErrorCode.UNEXPECTED_ERROR,
              error instanceof Error
                ? error.message
                : "Unknown error in generateAudioChunk"
            );
      return { success: false, error: appErr };
    }
  }
);
