import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";
import { YoutubeVideoInfo } from "@/types";
import { appErrors } from "@/types/actions";
import { createAdminClient } from "./supabase";

const execAsync = promisify(exec);

/**
 * Extract YouTube video ID from a URL
 * @param url YouTube URL
 * @returns YouTube video ID
 */
export function extractYoutubeId(url: string): string | null {
  if (!url) return null;

  // Regular expressions to match different YouTube URL formats
  const patterns = [
    /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i,
    /^([a-zA-Z0-9_-]{11})$/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * Check if a URL is a valid YouTube URL
 * @param url URL to check
 * @returns Whether the URL is a valid YouTube URL
 */
export function isValidYoutubeUrl(url: string): boolean {
  return !!extractYoutubeId(url);
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
      .from("yotube-audio")
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

    // Save the audio extract info in database
    await adminClient.from("yotube-audio").insert({
      youtube_id: videoId,
      start_time: startTime,
      end_time: endTime,
    });
  } catch (error) {
    console.error("Error downloading audio:", error);
    throw appErrors.DOWNLOAD_ERROR;
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
