"use server";

import { z } from "zod";
import { createSafeActionClient } from "next-safe-action";
import { ActionResponse, AppError, AppErrorCode } from "../actions";
import { config } from "@/config";
import { generateOpenAiTts } from "@/lib/openai-tts";
import { generateGoogleTts } from "@/lib/google-tts";
import { createLogger } from "@/lib/logger";
import { createServerClient } from "@supabase/ssr";
import { cookies, headers as nextHeaders } from "next/headers";
import type { Database } from "@/types/supabase";

const audioLogger = createLogger("audio-generation-service");

// Context interface for middleware
interface ActionContext {
  userId?: string;
  ipAddress?: string;
  supabaseClient: ReturnType<typeof createServerClient<Database>>;
}

// Function to map AppErrorCode to HTTP status codes (can be shared or redefined)
function getStatusCodeFromAppError(code: AppErrorCode): number {
  switch (code) {
    case AppErrorCode.INVALID_INPUT:
    case AppErrorCode.VALIDATION_ERROR:
      return 400;
    case AppErrorCode.UNAUTHENTICATED:
      return 401;
    case AppErrorCode.UNAUTHORIZED:
    case AppErrorCode.FORBIDDEN:
      return 403;
    case AppErrorCode.RECORD_NOT_FOUND: // Add if relevant
      return 404;
    // Add other specific mappings as needed
    default:
      return 500;
  }
}

// Create a new action client with middleware
const audioAction = createSafeActionClient({
  async middleware(): Promise<ActionContext> {
    const cookieStore = cookies();
    const requestHeaders = nextHeaders();
    const authorization = requestHeaders.get("authorization") ?? undefined;
    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: authorization
          ? { headers: { Authorization: authorization } }
          : undefined,
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
        },
      }
    );
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const ip =
      requestHeaders.get("x-forwarded-for") ??
      requestHeaders.get("remote_addr");
    return {
      userId: user?.id,
      ipAddress: ip ?? undefined,
      supabaseClient: supabase,
    };
  },
  handleReturnedServerError(e: Error) {
    let loggedErrorCodeStr: string =
      AppErrorCode[AppErrorCode.UNEXPECTED_ERROR];
    let responseStatusCode: number = 500;
    let originalErrorCode: AppErrorCode = AppErrorCode.UNEXPECTED_ERROR;

    if (e instanceof AppError) {
      loggedErrorCodeStr = AppErrorCode[e.code];
      originalErrorCode = e.code;
      responseStatusCode = getStatusCodeFromAppError(e.code);
    }

    audioLogger.error("server-error-handler", {
      error_code: loggedErrorCodeStr,
      error_message: e.message,
      stack_trace: e.stack,
      response_status_code: responseStatusCode,
    });
    return {
      serverError: e.message,
      code: originalErrorCode,
    };
  },
});

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

export const generateAudioChunk = audioAction(
  generateAudioSchema,
  async (
    { language, voice, startTime, endTime, text }: GenerateAudioChunkInput,
    { userId, ipAddress, supabaseClient }: ActionContext
  ): Promise<ActionResponse<{ audioBase64: string; mimeType: string }>> => {
    const actionStartTime = Date.now();
    const actionName = "generate-audio-chunk";

    audioLogger.info(actionName, {
      user_id: userId,
      ip_address: ipAddress,
      request_payload: {
        language,
        voice,
        startTime,
        endTime,
        textLength: text.length,
      },
      metadata: { custom_message: "Attempting to generate audio chunk." },
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
        const durationMs = Date.now() - actionStartTime;
        audioLogger.error(actionName, {
          user_id: userId,
          ip_address: ipAddress,
          request_payload: {
            language,
            voice,
            startTime,
            endTime,
            textLength: text.length,
          },
          error_code: AppErrorCode[invalidInputError.code],
          error_message: invalidInputError.message,
          duration_ms: durationMs,
          response_status_code: getStatusCodeFromAppError(
            invalidInputError.code
          ),
        });
        return {
          success: false,
          error: invalidInputError,
        };
      }
    }

    // Authorization Check: Premium voice for premium users
    if (ttsProvider && userId) {
      const { data: profile, error: profileError } = await supabaseClient
        .from("profiles")
        .select("subscription_status")
        .eq("id", userId)
        .single();

      if (profileError) {
        audioLogger.error(actionName, {
          user_id: userId,
          ip_address: ipAddress,
          request_payload: {
            language,
            voice,
            startTime,
            endTime,
            textLength: text.length,
          },
          error_code: AppErrorCode[AppErrorCode.UNEXPECTED_ERROR],
          error_message: `Failed to fetch user profile: ${profileError.message}`,
          duration_ms: Date.now() - actionStartTime,
          response_status_code: 500,
        });
        return {
          success: false,
          error: new AppError(
            AppErrorCode.UNEXPECTED_ERROR,
            "Failed to verify user subscription status."
          ),
        };
      }

      if (!profile || profile.subscription_status !== "premium") {
        const forbiddenError = new AppError(
          AppErrorCode.FORBIDDEN,
          `Voice '${voice}' is a premium voice and requires an active premium subscription.`
        );
        const durationMs = Date.now() - actionStartTime;
        audioLogger.warn(actionName, {
          user_id: userId,
          ip_address: ipAddress,
          request_payload: {
            language,
            voice,
            startTime,
            endTime,
            textLength: text.length,
          },
          error_code: AppErrorCode[forbiddenError.code],
          error_message: forbiddenError.message,
          duration_ms: durationMs,
          response_status_code: getStatusCodeFromAppError(forbiddenError.code),
          metadata: {
            subscription_status: profile?.subscription_status || "unknown",
          },
        });
        return {
          success: false,
          error: forbiddenError,
        };
      }
    } else if (ttsProvider && !userId) {
      const unauthenticatedError = new AppError(
        AppErrorCode.UNAUTHENTICATED,
        `Authentication is required to use premium voice '${voice}'.`
      );
      const durationMs = Date.now() - actionStartTime;
      audioLogger.warn(actionName, {
        user_id: userId,
        ip_address: ipAddress,
        request_payload: {
          language,
          voice,
          startTime,
          endTime,
          textLength: text.length,
        },
        error_code: AppErrorCode[unauthenticatedError.code],
        error_message: unauthenticatedError.message,
        duration_ms: durationMs,
        response_status_code: getStatusCodeFromAppError(
          unauthenticatedError.code
        ),
      });
      return {
        success: false,
        error: unauthenticatedError,
      };
    }

    if (!ttsProvider) {
      const providerError = new AppError(
        AppErrorCode.UNEXPECTED_ERROR,
        `Failed to determine TTS provider for language '${language}' and voice '${voice}'.`
      );
      const durationMs = Date.now() - actionStartTime;
      audioLogger.error(actionName, {
        user_id: userId,
        ip_address: ipAddress,
        request_payload: {
          language,
          voice,
          startTime,
          endTime,
          textLength: text.length,
        },
        error_code: AppErrorCode[providerError.code],
        error_message: providerError.message,
        duration_ms: durationMs,
        response_status_code: getStatusCodeFromAppError(providerError.code),
      });
      return {
        success: false,
        error: providerError,
      };
    }

    try {
      audioLogger.debug(actionName, {
        user_id: userId,
        ip_address: ipAddress,
        request_payload: {
          language,
          voice,
          startTime,
          endTime,
          textLength: text.length,
        },
        metadata: {
          custom_message: "Starting direct TTS generation.",
          ttsProvider,
          textSnippet: textToSynthesize.substring(0, 50),
        },
      });

      if (!textToSynthesize) {
        const noTextError = new AppError(
          AppErrorCode.INVALID_INPUT,
          `No text provided for TTS.`
        );
        const durationMs = Date.now() - actionStartTime;
        audioLogger.error(actionName, {
          user_id: userId,
          ip_address: ipAddress,
          request_payload: {
            language,
            voice,
            startTime,
            endTime,
            textLength: text.length,
          },
          error_code: AppErrorCode[noTextError.code],
          error_message: noTextError.message,
          duration_ms: durationMs,
          response_status_code: getStatusCodeFromAppError(noTextError.code),
        });
        return { success: false, error: noTextError };
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
      const durationMs = Date.now() - actionStartTime;

      audioLogger.info(actionName, {
        user_id: userId,
        ip_address: ipAddress,
        request_payload: {
          language,
          voice,
          startTime,
          endTime,
          textLength: text.length,
        },
        duration_ms: durationMs,
        response_status_code: 200,
        metadata: {
          custom_message: "TTS generation successful.",
          mimeType,
          audioLengthBase64: audioBase64.length,
        },
      });
      return { success: true, data: { audioBase64, mimeType } };
    } catch (error: unknown) {
      const durationMs = Date.now() - actionStartTime;
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
        user_id: userId,
        ip_address: ipAddress,
        request_payload: {
          language,
          voice,
          startTime,
          endTime,
          textLength: text.length,
        },
        error_code: AppErrorCode[appErr.code],
        error_message: appErr.message,
        stack_trace: appErr.stack,
        duration_ms: durationMs,
        response_status_code: getStatusCodeFromAppError(appErr.code),
        metadata: { rawError: String(error) },
      });
      return { success: false, error: appErr };
    }
  }
);
