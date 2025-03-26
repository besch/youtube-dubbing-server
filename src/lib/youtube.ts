import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";
import { YoutubeVideoInfo } from "@/types";
import { appErrors } from "@/types/actions";
import { extractYoutubeAudio, getS3PreSignedUrl } from "./aws-services";
import { createAdminClient } from "./supabase";

const execAsync = promisify(exec);

// Extract YouTube video ID from URL
export function extractYoutubeId(url: string): string | null {
  const regExp =
    /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
  const match = url.match(regExp);
  return match && match[7].length === 11 ? match[7] : null;
}

// Validate YouTube URL
export function isValidYoutubeUrl(url: string): boolean {
  const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+$/;
  return youtubeRegex.test(url);
}

// Get temporary directory for downloading videos
export function getTempDir() {
  return path.join(os.tmpdir(), "youtube-dubbing");
}

// Create temp directory if it doesn't exist
export async function ensureTempDir() {
  const tempDir = getTempDir();
  if (!fs.existsSync(tempDir)) {
    await fs.promises.mkdir(tempDir, { recursive: true });
  }
  return tempDir;
}

// Get video info from YouTube using YouTube API
// We now use YouTube API instead of yt-dlp
export async function getVideoInfo(videoId: string): Promise<YoutubeVideoInfo> {
  try {
    // Use YouTube API from youtube-api.ts
    const { getVideoDetails } = await import("./youtube-api");
    return await getVideoDetails(videoId);
  } catch (error) {
    console.error("Error getting video info:", error);
    throw appErrors.VIDEO_NOT_FOUND;
  }
}

// Download audio from YouTube video using AWS Lambda
export async function downloadAudio(
  videoId: string,
  startTime: number,
  endTime: number
): Promise<string> {
  try {
    // Check if we already have this audio chunk in Supabase storage
    const adminClient = createAdminClient();
    const { data: existingChunk } = await adminClient
      .from("audio_extracts")
      .select("*")
      .eq("youtube_id", videoId)
      .gte("start_time", startTime - 1) // Allow for small variations
      .lte("end_time", endTime + 1)
      .single();

    if (existingChunk) {
      // We already have this chunk
      return existingChunk.s3_key;
    }

    // Otherwise, extract audio using AWS Lambda
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const { success, s3Key, error } = await extractYoutubeAudio(
      youtubeUrl,
      videoId
    );

    if (!success || !s3Key) {
      console.error("Error extracting audio:", error);
      throw appErrors.DOWNLOAD_ERROR;
    }

    // Save the audio extract info in database
    await adminClient.from("audio_extracts").insert({
      youtube_id: videoId,
      start_time: startTime,
      end_time: endTime,
      s3_key: s3Key,
    });

    return s3Key;
  } catch (error) {
    console.error("Error downloading audio:", error);
    throw appErrors.DOWNLOAD_ERROR;
  }
}

// Get a signed URL for a S3 audio file
export async function getAudioUrl(s3Key: string): Promise<string> {
  try {
    return await getS3PreSignedUrl(s3Key);
  } catch (error) {
    console.error("Error getting audio URL:", error);
    throw appErrors.UNEXPECTED_ERROR;
  }
}

// Download video from YouTube
export async function downloadVideo(videoId: string): Promise<string> {
  const tempDir = await ensureTempDir();
  const outputPath = path.join(tempDir, `${videoId}.mp4`);

  try {
    // Use yt-dlp to download the video
    await execAsync(
      `yt-dlp -f "best[height<=720]" -o "${outputPath}" "https://www.youtube.com/watch?v=${videoId}"`
    );

    return outputPath;
  } catch (error) {
    console.error("Error downloading video:", error);
    throw appErrors.DOWNLOAD_ERROR;
  }
}

// Clean up temp files
export async function cleanupTempFiles(filePath: string) {
  try {
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
  } catch (error) {
    console.error("Error cleaning up temp file:", error);
  }
}
