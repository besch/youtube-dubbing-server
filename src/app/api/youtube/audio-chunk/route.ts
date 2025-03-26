import { NextResponse } from "next/server";
import { createAdminClient, createServerClient } from "@/lib/supabase";
import { TranscriptionSegment, Voice } from "@/types";
import { appErrors } from "@/types/actions";
import {
  transcribeAudio,
  translateText,
  generateAndUploadSpeech,
} from "@/lib/ai-services";

export async function POST(request: Request) {
  try {
    console.log("Getting audio chunk", request);
    // Create Supabase clients
    const supabase = createServerClient();
    const adminClient = createAdminClient();

    // Check if user is authenticated (but don't require it)
    const { data: session } = await supabase.auth.getSession();
    const userId = session?.session?.user.id;

    // Parse request body
    const { videoId, dbVideoId, startTime, endTime, language, voice } =
      await request.json();

    if (
      !videoId ||
      !dbVideoId ||
      startTime === undefined ||
      endTime === undefined ||
      !language ||
      !voice
    ) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_REQUEST",
            message: "Missing required parameters",
          },
        },
        { status: 400 }
      );
    }

    // Check if we already have this audio chunk
    const { data: existingChunk } = await adminClient
      .from("audio_chunks")
      .select("*")
      .eq("video_id", dbVideoId)
      .eq("language", language)
      .eq("voice", voice as Voice)
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

      return NextResponse.json({
        success: true,
        data: {
          url: publicUrl,
          startTime: existingChunk.start_time,
          endTime: existingChunk.end_time,
        },
      });
    }

    // Check if we have a transcription for this time range
    const { data: existingTranscription } = await adminClient
      .from("transcriptions")
      .select("*")
      .eq("video_id", dbVideoId)
      .lte("chunk_start", startTime)
      .gte("chunk_end", endTime)
      .single();

    let transcriptionData: TranscriptionSegment[];

    if (existingTranscription) {
      // Use existing transcription
      transcriptionData = existingTranscription.content;
    } else {
      // We need to find the audio extract for this video
      const { data: audioExtract } = await adminClient
        .from("audio_extracts")
        .select("*")
        .eq("youtube_id", videoId)
        .gte("end_time", endTime)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (!audioExtract) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "NO_AUDIO_EXTRACT",
              message:
                "Audio extract not found. Please wait for processing to complete.",
            },
          },
          { status: 404 }
        );
      }

      // Transcribe the audio
      const transcription = await transcribeAudio(
        audioExtract.s3_key,
        language
      );

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
        throw appErrors.DATABASE_ERROR;
      }

      transcriptionData = transcription;
    }

    // Generate text to speak based on the transcription
    // Filter segments that are within our time range
    const relevantSegments = Array.isArray(transcriptionData)
      ? transcriptionData.filter(
          (segment: TranscriptionSegment) =>
            segment.start >= startTime && segment.end <= endTime
        )
      : [];

    if (relevantSegments.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "NO_SPEECH_CONTENT",
            message: "No speech content found in this time range",
          },
        },
        { status: 404 }
      );
    }

    // Check if the user has favorited this video (if authenticated)
    let isFavorite = false;
    if (userId) {
      const { data: favorite } = await adminClient
        .from("favorites")
        .select("*")
        .eq("user_id", userId)
        .eq("video_id", dbVideoId)
        .eq("language", language)
        .eq("voice", voice)
        .single();

      isFavorite = !!favorite;
    }

    // Generate a combined text from all segments
    let combinedText = relevantSegments
      .map((segment: TranscriptionSegment) => segment.text)
      .join(" ");

    // Translate text if target language is different from transcription language
    // We assume transcription is in the original video language, typically English
    const transcriptionLanguage = "en"; // Default language for transcription
    if (language !== transcriptionLanguage) {
      try {
        console.log(`Translating from ${transcriptionLanguage} to ${language}`);
        combinedText = await translateText(
          combinedText,
          transcriptionLanguage,
          language
        );
      } catch (error) {
        console.error("Translation error:", error);
        // Continue with original text if translation fails
      }
    }

    // Generate and upload the audio
    const storagePath = await generateAndUploadSpeech(
      combinedText,
      voice as Voice,
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

    return NextResponse.json({
      success: true,
      data: {
        url: publicUrl,
        startTime,
        endTime,
      },
    });
  } catch (error) {
    console.error("Error getting audio chunk:", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "UNEXPECTED_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "An unexpected error occurred",
        },
      },
      { status: 500 }
    );
  }
}
