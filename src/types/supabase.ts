export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          display_name: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
          settings: Json;
        };
        Insert: {
          id: string;
          email: string;
          display_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
          settings?: Json;
        };
        Update: {
          id?: string;
          email?: string;
          display_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
          settings?: Json;
        };
      };
      videos: {
        Row: {
          id: string;
          youtube_id: string;
          title: string | null;
          description: string | null;
          thumbnail_url: string | null;
          duration: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          youtube_id: string;
          title?: string | null;
          description?: string | null;
          thumbnail_url?: string | null;
          duration?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          youtube_id?: string;
          title?: string | null;
          description?: string | null;
          thumbnail_url?: string | null;
          duration?: number | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      history: {
        Row: {
          id: string;
          user_id: string;
          video_id: string;
          language: string;
          voice: string;
          watched_at: string;
          last_position: number;
        };
        Insert: {
          id?: string;
          user_id: string;
          video_id: string;
          language: string;
          voice: string;
          watched_at?: string;
          last_position?: number;
        };
        Update: {
          id?: string;
          user_id?: string;
          video_id?: string;
          language?: string;
          voice?: string;
          watched_at?: string;
          last_position?: number;
        };
      };
      favorites: {
        Row: {
          id: string;
          user_id: string;
          video_id: string;
          language: string;
          voice: string;
          added_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          video_id: string;
          language: string;
          voice: string;
          added_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          video_id?: string;
          language?: string;
          voice?: string;
          added_at?: string;
        };
      };
      audio_chunks: {
        Row: {
          id: string;
          video_id: string;
          language: string;
          voice: string;
          start_time: number;
          end_time: number;
          storage_path: string;
          created_at: string;
          expiry_at: string;
          is_favorite: boolean;
        };
        Insert: {
          id?: string;
          video_id: string;
          language: string;
          voice: string;
          start_time: number;
          end_time: number;
          storage_path: string;
          created_at?: string;
          expiry_at: string;
          is_favorite?: boolean;
        };
        Update: {
          id?: string;
          video_id?: string;
          language?: string;
          voice?: string;
          start_time?: number;
          end_time?: number;
          storage_path?: string;
          created_at?: string;
          expiry_at?: string;
          is_favorite?: boolean;
        };
      };
      transcriptions: {
        Row: {
          id: string;
          video_id: string;
          chunk_start: number;
          chunk_end: number;
          content: Json;
          created_at: string;
          expiry_at: string;
          is_favorite: boolean;
        };
        Insert: {
          id?: string;
          video_id: string;
          chunk_start: number;
          chunk_end: number;
          content: Json;
          created_at?: string;
          expiry_at: string;
          is_favorite?: boolean;
        };
        Update: {
          id?: string;
          video_id?: string;
          chunk_start?: number;
          chunk_end?: number;
          content?: Json;
          created_at?: string;
          expiry_at?: string;
          is_favorite?: boolean;
        };
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
  };
}
