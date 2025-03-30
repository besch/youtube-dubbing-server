// Placeholder functions for YouTube utilities
// TODO: Implement actual logic

export function isValidYoutubeUrl(url: string): boolean {
  console.warn("isValidYoutubeUrl not implemented");
  // Basic check for now
  return url.includes("youtube.com") || url.includes("youtu.be");
}

export function extractYoutubeId(url: string): string | null {
  console.warn("extractYoutubeId not implemented, using basic regex");
  // Basic regex (might need improvement)
  const regex =
    /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

export async function getVideoInfo(
  videoId: string
): Promise<{
  title: string;
  description: string;
  thumbnail_url: string;
  duration: number;
}> {
  console.warn("getVideoInfo not implemented");
  // Requires youtube data api or another library server-side
  return {
    title: `Video ${videoId}`, // Placeholder
    description: "Placeholder description",
    thumbnail_url: "",
    duration: 0, // Placeholder
  };
}

// This function is likely obsolete on the server now, as downloads are handled by the youtube-download service.
export async function downloadAudio(
  videoId: string,
  startTime?: number,
  endTime?: number
): Promise<string> {
  console.warn("Server-side downloadAudio called - This might be obsolete.");
  throw new Error("Server-side audio download not implemented/needed.");
}
