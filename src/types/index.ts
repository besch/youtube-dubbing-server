import { config } from "@/config";
import { Database } from "./supabase";

export type Voice = string;

export interface Language {
  code: string;
  name: string;
}

export interface YoutubeVideoInfo {
  id: string;
  title: string;
  description: string;
  thumbnail_url: string;
  duration: number;
}

export interface TranscriptionSegment {
  end: number;
  text: string;
  start: number;
  words: TranscriptionWord[];
  speaker: string;
  duration: number;
  avg_logprob: number;
}

export interface TranscriptionWord {
  end: number;
  word: string;
  start: number;
  speaker: string;
  probability: number;
}

export interface AudioChunkMetadata {
  videoId: string;
  language: string;
  voice: Voice;
  startTime: number;
  endTime: number;
  storagePath: string;
  expiryAt: Date;
  isFavorite: boolean;
}

export interface User {
  id: string;
  email: string;
  displayName?: string;
  avatarUrl?: string;
  settings: UserSettings;
}

export interface UserSettings {
  defaultLanguage: string;
  defaultVoice: Voice;
}

export type Tables = Database["public"]["Tables"];
export type Profile = Tables["profiles"]["Row"];
export type Video = Tables["videos"]["Row"];
export type History = Tables["history"]["Row"];
export type Favorite = Tables["favorites"]["Row"];
export type AudioChunk = Tables["translated_audio_chunks"]["Row"];
export type TranscriptionSegmentDb = Tables["transcription_segments"]["Row"];
