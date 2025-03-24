"use server";

import { createSafeActionClient } from "next-safe-action";
import { z } from "zod";
import type { ActionResponse } from "@/types/actions";
import { appErrors } from "@/types/actions";
import { createAdminClient, createServerClient } from "@/lib/supabase";
import {
  downloadAudio,
  extractYoutubeId,
  getVideoInfo,
  isValidYoutubeUrl,
} from "@/lib/youtube";
import { config } from "@/config";
import { generateAndUploadSpeech, transcribeAudio } from "@/lib/ai-services";
import { Voice } from "@/types";
import { randomUUID } from "crypto";

const action = createSafeActionClient();

// Schema for processing a YouTube URL
const processYoutubeUrlSchema = z.object({
  url: z.string().url(),
  language: z.string().min(2).max(5),
  voice: z.enum(["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const),
});

export const processYoutubeUrl = action
  .schema(processYoutubeUrlSchema)
  .action(async ({ parsedInput }) => {
    const { url, language, voice } = parsedInput;

    try {
      // Check if the URL is valid
      if (!isValidYoutubeUrl(url)) {
        return { success: false, error: appErrors.INVALID_YOUTUBE_URL };
      }

      // Extract the video ID
      const videoId = extractYoutubeId(url);
      if (!videoId) {
        return { success: false, error: appErrors.INVALID_YOUTUBE_URL };
      }

      // Check authentication
      const supabase = createServerClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        return { success: false, error: appErrors.AUTHENTICATION_ERROR };
      }

      // Get or create video info
      const adminClient = createAdminClient();
      const { data: existingVideo } = await adminClient
        .from("videos")
        .select("*")
        .eq("youtube_id", videoId)
        .single();

      let dbVideoId: string;

      if (existingVideo) {
        dbVideoId = existingVideo.id;
      } else {
        // Get video info from YouTube
        const videoInfo = await getVideoInfo(videoId);

        // Insert into the database
        const { data: newVideo, error } = await adminClient
          .from("videos")
          .insert({
            youtube_id: videoId,
            title: videoInfo.title,
            description: videoInfo.description,
            thumbnail_url: videoInfo.thumbnail_url,
            duration: videoInfo.duration,
          })
          .select()
          .single();

        if (error || !newVideo) {
          console.error("Error inserting video:", error);
          return { success: false, error: appErrors.DATABASE_ERROR };
        }

        dbVideoId = newVideo.id;
      }

      // Add to user's history
      await adminClient.from("history").upsert({
        user_id: session.user.id,
        video_id: dbVideoId,
        language,
        voice,
        watched_at: new Date().toISOString(),
        last_position: 0,
      });

      return {
        success: true,
        data: {
          videoId,
          dbVideoId,
        },
      };
    } catch (error) {
      console.error("Error processing YouTube URL:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? {
                code: "UNEXPECTED_ERROR",
                message: error.message,
              }
            : appErrors.UNEXPECTED_ERROR,
      };
    }
  });

// Schema for requesting a specific audio chunk
const getAudioChunkSchema = z.object({
  videoId: z.string(),
  dbVideoId: z.string().uuid(),
  startTime: z.number().min(0),
  endTime: z.number().min(0),
  language: z.string().min(2).max(5),
  voice: z.enum(["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const),
});

export const getAudioChunk = action
  .schema(getAudioChunkSchema)
  .action(async ({ parsedInput }) => {
    const { videoId, dbVideoId, startTime, endTime, language, voice } =
      parsedInput;

    try {
      // Check authentication
      const supabase = createServerClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        return { success: false, error: appErrors.AUTHENTICATION_ERROR };
      }

      // Check if we already have this audio chunk
      const adminClient = createAdminClient();
      const { data: existingChunk } = await adminClient
        .from("audio_chunks")
        .select("*")
        .eq("video_id", dbVideoId)
        .eq("language", language)
        .eq("voice", voice)
        .gte("start_time", startTime - 0.5) // Allow for small variations in start/end times
        .lte("end_time", endTime + 0.5)
        .single();

      if (existingChunk) {
        // We already have this chunk, return the URL
        const {
          data: { publicUrl },
        } = adminClient.storage
          .from("audio_chunks")
          .getPublicUrl(existingChunk.storage_path);

        return {
          success: true,
          data: {
            url: publicUrl,
            startTime: existingChunk.start_time,
            endTime: existingChunk.end_time,
          },
        };
      }

      // Check if we have a transcription for this time range
      const { data: existingTranscription } = await adminClient
        .from("transcriptions")
        .select("*")
        .eq("video_id", dbVideoId)
        .lte("chunk_start", startTime)
        .gte("chunk_end", endTime)
        .single();

      let transcriptionData: any;

      if (existingTranscription) {
        // Use existing transcription
        transcriptionData = existingTranscription.content;
      } else {
        // We need to download and transcribe this chunk
        const audioFilePath = await downloadAudio(videoId, startTime, endTime);

        // Transcribe the audio
        const transcription = await transcribeAudio(audioFilePath, language);

        // Save the transcription
        const expiryAt = new Date();
        expiryAt.setDate(expiryAt.getDate() + 1); // 24 hours by default

        const { error } = await adminClient.from("transcriptions").insert({
          video_id: dbVideoId,
          chunk_start: startTime,
          chunk_end: endTime,
          content: transcription,
          expiry_at: expiryAt.toISOString(),
          is_favorite: false,
        });

        if (error) {
          console.error("Error saving transcription:", error);
          return { success: false, error: appErrors.DATABASE_ERROR };
        }

        transcriptionData = transcription;
      }

      // Generate text to speak based on the transcription
      // Filter segments that are within our time range
      const relevantSegments = Array.isArray(transcriptionData)
        ? transcriptionData.filter(
            (segment: any) =>
              segment.start >= startTime && segment.end <= endTime
          )
        : [];

      if (relevantSegments.length === 0) {
        return {
          success: false,
          error: {
            code: "NO_SPEECH_CONTENT",
            message: "No speech content found in this time range",
          },
        };
      }

      // Check if the user has favorited this video
      const { data: favorite } = await adminClient
        .from("favorites")
        .select("*")
        .eq("user_id", session.user.id)
        .eq("video_id", dbVideoId)
        .eq("language", language)
        .eq("voice", voice)
        .single();

      const isFavorite = !!favorite;

      // Generate and upload speeches for each segment
      const speakerVoiceMap: Record<string, Voice> = {};

      // Map speakers to voices if multiple speakers
      if (relevantSegments.length > 0) {
        const speakers = [
          ...new Set(relevantSegments.map((segment: any) => segment.speaker)),
        ];

        if (speakers.length > 1) {
          // If we have multiple speakers, assign different voices
          const availableVoices: Voice[] = [
            "alloy",
            "echo",
            "fable",
            "onyx",
            "nova",
            "shimmer",
          ];
          const userSelectedVoice = voice;

          // Put the user-selected voice first
          const voices = [
            userSelectedVoice,
            ...availableVoices.filter((v) => v !== userSelectedVoice),
          ];

          // Assign a voice to each speaker
          speakers.forEach((speaker, index) => {
            speakerVoiceMap[speaker] = voices[index % voices.length];
          });
        } else {
          // Only one speaker, use the selected voice
          speakerVoiceMap[relevantSegments[0].speaker] = voice;
        }
      }

      // Generate a combined text from all segments
      const combinedText = relevantSegments
        .map((segment: any) => segment.text)
        .join(" ");

      // Generate and upload the audio
      const storagePath = await generateAndUploadSpeech(
        combinedText,
        voice,
        dbVideoId,
        language,
        startTime,
        endTime,
        isFavorite
      );

      // Get the public URL
      const {
        data: { publicUrl },
      } = adminClient.storage.from("audio_chunks").getPublicUrl(storagePath);

      return {
        success: true,
        data: {
          url: publicUrl,
          startTime,
          endTime,
        },
      };
    } catch (error) {
      console.error("Error getting audio chunk:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? {
                code: "UNEXPECTED_ERROR",
                message: error.message,
              }
            : appErrors.UNEXPECTED_ERROR,
      };
    }
  });

// Schema for updating watch history
const updateHistorySchema = z.object({
  videoId: z.string().uuid(),
  position: z.number().min(0),
});

export const updateHistory = action
  .schema(updateHistorySchema)
  .action(async ({ parsedInput }) => {
    const { videoId, position } = parsedInput;

    try {
      // Check authentication
      const supabase = createServerClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        return { success: false, error: appErrors.AUTHENTICATION_ERROR };
      }

      // Update the history
      const adminClient = createAdminClient();
      const { error } = await adminClient
        .from("history")
        .update({
          last_position: position,
          watched_at: new Date().toISOString(),
        })
        .eq("user_id", session.user.id)
        .eq("video_id", videoId);

      if (error) {
        console.error("Error updating history:", error);
        return { success: false, error: appErrors.DATABASE_ERROR };
      }

      return { success: true };
    } catch (error) {
      console.error("Error updating history:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? {
                code: "UNEXPECTED_ERROR",
                message: error.message,
              }
            : appErrors.UNEXPECTED_ERROR,
      };
    }
  });

// Schema for toggling favorite status
const toggleFavoriteSchema = z.object({
  videoId: z.string().uuid(),
  language: z.string().min(2).max(5),
  voice: z.enum(["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const),
});

export const toggleFavorite = action
  .schema(toggleFavoriteSchema)
  .action(async ({ parsedInput }) => {
    const { videoId, language, voice } = parsedInput;

    try {
      // Check authentication
      const supabase = createServerClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        return { success: false, error: appErrors.AUTHENTICATION_ERROR };
      }

      const adminClient = createAdminClient();

      // Check if already favorited
      const { data: existing } = await adminClient
        .from("favorites")
        .select("*")
        .eq("user_id", session.user.id)
        .eq("video_id", videoId)
        .eq("language", language)
        .eq("voice", voice)
        .single();

      if (existing) {
        // Remove from favorites
        const { error } = await adminClient
          .from("favorites")
          .delete()
          .eq("id", existing.id);

        if (error) {
          console.error("Error removing favorite:", error);
          return { success: false, error: appErrors.DATABASE_ERROR };
        }

        return { success: true, data: { isFavorite: false } };
      } else {
        // Add to favorites
        const { error } = await adminClient.from("favorites").insert({
          user_id: session.user.id,
          video_id: videoId,
          language,
          voice,
        });

        if (error) {
          console.error("Error adding favorite:", error);
          return { success: false, error: appErrors.DATABASE_ERROR };
        }

        return { success: true, data: { isFavorite: true } };
      }
    } catch (error) {
      console.error("Error toggling favorite:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? {
                code: "UNEXPECTED_ERROR",
                message: error.message,
              }
            : appErrors.UNEXPECTED_ERROR,
      };
    }
  });
