import { createHash } from "crypto";
import { supabaseServiceRoleClient } from "@/lib/supabase/serviceRoleClient";

/**
 * Caches synthesized TTS audio in Supabase Storage so that identical
 * (text + language + voice) chunks are only synthesized once. This avoids
 * repeated paid TTS calls on every request/seek and dramatically cuts
 * latency and cost under concurrent users.
 */

const BUCKET = process.env.AUDIO_CACHE_BUCKET || "generated-audio";

function buildKey(params: {
  language: string;
  voice: string;
  text: string;
}): string {
  const hash = createHash("sha256")
    .update(`${params.language}|${params.voice}|${params.text}`)
    .digest("hex");
  return `${hash}.mp3`;
}

export async function getCachedAudio(
  params: { language: string; voice: string; text: string }
): Promise<Buffer | null> {
  try {
    const path = buildKey(params);
    const { data, error } = await supabaseServiceRoleClient.storage
      .from(BUCKET)
      .download(path);
    if (error || !data) return null;
    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    // Cache is best-effort; on any failure fall back to synthesis.
    return null;
  }
}

export async function setCachedAudio(
  params: { language: string; voice: string; text: string },
  audioBuffer: Buffer
): Promise<void> {
  try {
    const path = buildKey(params);
    const { error } = await supabaseServiceRoleClient.storage
      .from(BUCKET)
      .upload(path, audioBuffer, {
        contentType: "audio/mpeg",
        upsert: true,
        cacheControl: "31536000",
      });
    if (error) {
      // Non-fatal: logging only.
      console.warn("audioCache: failed to store chunk", error.message);
    }
  } catch {
    // Best-effort cache write.
  }
}
