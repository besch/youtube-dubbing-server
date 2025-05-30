"use server";

import { z } from "zod";
import { createSafeActionClient } from "next-safe-action";
import { ActionResponse, AppError, AppErrorCode } from "../actions";
import { config } from "@/config";
import { generateOpenAiTts } from "@/lib/openai-tts";
import { generateGoogleTts } from "@/lib/google-tts";
import { createLogger } from "@/lib/logger";

const audioLogger = createLogger("audio-generation-service");

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
    const actionName = "generate-audio-chunk";
    audioLogger.info(actionName, {
      metadata: { custom_message: "Attempting to generate audio chunk." },
      request_payload: {
        language,
        voice,
        startTime,
        endTime,
        textLength: text.length,
      },
    });

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
        const invalidInputError = new AppError(
          AppErrorCode.INVALID_INPUT,
          errorMessage
        );
        audioLogger.error(actionName, {
          error_code: AppErrorCode[invalidInputError.code],
          error_message: invalidInputError.message,
          request_payload: { language, voice },
        });
        return {
          success: false,
          error: invalidInputError,
        };
      }
    }
    if (!ttsProvider) {
      const providerError = new AppError(
        AppErrorCode.UNEXPECTED_ERROR,
        `Failed to determine TTS provider for language '${language}' and voice '${voice}'.`
      );
      audioLogger.error(actionName, {
        error_code: AppErrorCode[providerError.code],
        error_message: providerError.message,
        request_payload: { language, voice },
      });
      return {
        success: false,
        error: providerError,
      };
    }

    try {
      audioLogger.debug(actionName, {
        metadata: {
          custom_message: "Starting direct TTS generation.",
          language,
          voice,
          ttsProvider,
          textSnippet: textToSynthesize.substring(0, 50),
        },
      });

      if (!textToSynthesize) {
        const noTextError = new AppError(
          AppErrorCode.INVALID_INPUT,
          `No text provided for TTS.`
        );
        audioLogger.error(actionName, {
          error_code: AppErrorCode[noTextError.code],
          error_message: noTextError.message,
          request_payload: { language, voice, startTime, endTime },
        });
        return {
          success: false,
          error: noTextError,
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

      audioLogger.info(actionName, {
        metadata: {
          custom_message: "TTS generation successful.",
          language,
          voice,
          mimeType,
          audioLengthBase64: audioBase64.length,
        },
      });
      return { success: true, data: { audioBase64, mimeType } };
    } catch (error: unknown) {
      const appErr =
        error instanceof AppError
          ? error
          : new AppError(
              AppErrorCode.UNEXPECTED_ERROR,
              error instanceof Error
                ? error.message
                : "Unknown error in generateAudioChunk"
            );
      audioLogger.error(actionName, {
        error_code: AppErrorCode[appErr.code],
        error_message: appErr.message,
        request_payload: {
          language,
          voice,
          startTime,
          endTime,
          textLength: text.length,
        },
        stack_trace: appErr.stack,
        metadata: { rawError: String(error) },
      });
      return { success: false, error: appErr };
    }
  }
);
