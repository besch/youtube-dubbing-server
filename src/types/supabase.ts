export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      download_jobs: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          status: Database["public"]["Enums"]["job_status"]
          storage_path: string | null
          updated_at: string
          user_id: string | null
          video_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          status?: Database["public"]["Enums"]["job_status"]
          storage_path?: string | null
          updated_at?: string
          user_id?: string | null
          video_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          status?: Database["public"]["Enums"]["job_status"]
          storage_path?: string | null
          updated_at?: string
          user_id?: string | null
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "download_jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "download_jobs_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      favorites: {
        Row: {
          added_at: string
          id: string
          language: string
          user_id: string
          video_id: string
          voice: string
        }
        Insert: {
          added_at?: string
          id?: string
          language: string
          user_id: string
          video_id: string
          voice: string
        }
        Update: {
          added_at?: string
          id?: string
          language?: string
          user_id?: string
          video_id?: string
          voice?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      history: {
        Row: {
          id: string
          language: string
          last_position: number
          user_id: string
          video_id: string
          voice: string
          watched_at: string
        }
        Insert: {
          id?: string
          language: string
          last_position?: number
          user_id: string
          video_id: string
          voice: string
          watched_at?: string
        }
        Update: {
          id?: string
          language?: string
          last_position?: number
          user_id?: string
          video_id?: string
          voice?: string
          watched_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "history_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string
          id: string
          settings: Json
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email: string
          id: string
          settings?: Json
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
          settings?: Json
          updated_at?: string
        }
        Relationships: []
      }
      transcription_segments: {
        Row: {
          completed_at: string | null
          content: Json | null
          created_at: string
          end_time: number
          error_message: string | null
          id: string
          replicate_prediction_id: string | null
          segment_storage_path: string | null
          start_time: number
          status: Database["public"]["Enums"]["job_status"]
          translations: Json | null
          updated_at: string
          video_id: string
        }
        Insert: {
          completed_at?: string | null
          content?: Json | null
          created_at?: string
          end_time: number
          error_message?: string | null
          id?: string
          replicate_prediction_id?: string | null
          segment_storage_path?: string | null
          start_time: number
          status?: Database["public"]["Enums"]["job_status"]
          translations?: Json | null
          updated_at?: string
          video_id: string
        }
        Update: {
          completed_at?: string | null
          content?: Json | null
          created_at?: string
          end_time?: number
          error_message?: string | null
          id?: string
          replicate_prediction_id?: string | null
          segment_storage_path?: string | null
          start_time?: number
          status?: Database["public"]["Enums"]["job_status"]
          translations?: Json | null
          updated_at?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transcription_segments_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      translated_audio_chunks: {
        Row: {
          chunk_end: number
          chunk_start: number
          created_at: string
          expiry_at: string | null
          id: string
          is_favorite: boolean
          language: string
          storage_path: string
          video_id: string
          voice: string
        }
        Insert: {
          chunk_end: number
          chunk_start: number
          created_at?: string
          expiry_at?: string | null
          id?: string
          is_favorite?: boolean
          language: string
          storage_path: string
          video_id: string
          voice: string
        }
        Update: {
          chunk_end?: number
          chunk_start?: number
          created_at?: string
          expiry_at?: string | null
          id?: string
          is_favorite?: boolean
          language?: string
          storage_path?: string
          video_id?: string
          voice?: string
        }
        Relationships: [
          {
            foreignKeyName: "translated_audio_chunks_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      videos: {
        Row: {
          created_at: string
          description: string | null
          duration: number | null
          id: string
          processing_status: Json | null
          thumbnail_url: string | null
          title: string
          translated_titles: Json | null
          updated_at: string
          youtube_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          duration?: number | null
          id?: string
          processing_status?: Json | null
          thumbnail_url?: string | null
          title?: string
          translated_titles?: Json | null
          updated_at?: string
          youtube_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          duration?: number | null
          id?: string
          processing_status?: Json | null
          thumbnail_url?: string | null
          title?: string
          translated_titles?: Json | null
          updated_at?: string
          youtube_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_expired_resources: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
    }
    Enums: {
      job_status: "pending" | "processing" | "completed" | "failed"
      video_processing_status:
        | "pending"
        | "downloading"
        | "transcribing"
        | "translating"
        | "generating_audio"
        | "ready"
        | "failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      job_status: ["pending", "processing", "completed", "failed"],
      video_processing_status: [
        "pending",
        "downloading",
        "transcribing",
        "translating",
        "generating_audio",
        "ready",
        "failed",
      ],
    },
  },
} as const
