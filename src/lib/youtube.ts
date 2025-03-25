import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";
import { YoutubeVideoInfo } from "@/types";
import { appErrors } from "@/types/actions";

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

// Get video info from YouTube
export async function getVideoInfo(videoId: string): Promise<YoutubeVideoInfo> {
  const tempDir = await ensureTempDir();
  const outputPath = path.join(tempDir, `${videoId}-info.json`);

  try {
    // Use yt-dlp to get video info
    await execAsync(
      `yt-dlp -J "https://www.youtube.com/watch?v=${videoId}" > "${outputPath}"`
    );

    // Read and parse the info
    const infoData = await fs.promises.readFile(outputPath, "utf-8");
    const info = JSON.parse(infoData);

    return {
      id: videoId,
      title: info.title,
      description: info.description,
      thumbnail_url: info.thumbnail,
      duration: info.duration,
    };
  } catch (error) {
    console.error("Error getting video info:", error);
    throw appErrors.VIDEO_NOT_FOUND;
  } finally {
    // Clean up the info file
    try {
      if (fs.existsSync(outputPath)) {
        await fs.promises.unlink(outputPath);
      }
    } catch (error) {
      console.error("Error cleaning up info file:", error);
    }
  }
}

// Download audio from YouTube video
export async function downloadAudio(
  videoId: string,
  startTime: number,
  endTime: number
): Promise<string> {
  const tempDir = await ensureTempDir();
  const outputPath = path.join(
    tempDir,
    `${videoId}-${startTime}-${endTime}.mp3`
  );

  try {
    // Use yt-dlp to download the specified portion of the video as audio
    await execAsync(
      `yt-dlp -x --audio-format mp3 --postprocessor-args "-ss ${startTime} -to ${endTime}" -o "${outputPath}" "https://www.youtube.com/watch?v=${videoId}"`
    );

    return outputPath;
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
