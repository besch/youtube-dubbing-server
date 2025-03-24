// Common error type
export interface AppError {
  code: string;
  message: string;
}

// Response type for server actions
export interface ActionResponse<T = any> {
  success: boolean;
  data?: T;
  error?: AppError;
}

// Common application errors
export const appErrors = {
  UNEXPECTED_ERROR: {
    code: "UNEXPECTED_ERROR",
    message: "An unexpected error occurred",
  },
  AUTHENTICATION_ERROR: {
    code: "AUTHENTICATION_ERROR",
    message: "Authentication is required",
  },
  INVALID_YOUTUBE_URL: {
    code: "INVALID_YOUTUBE_URL",
    message: "Invalid YouTube URL",
  },
  VIDEO_NOT_FOUND: {
    code: "VIDEO_NOT_FOUND",
    message: "Video not found",
  },
  DOWNLOAD_ERROR: {
    code: "DOWNLOAD_ERROR",
    message: "Error downloading video",
  },
  TRANSCRIPTION_ERROR: {
    code: "TRANSCRIPTION_ERROR",
    message: "Error transcribing video",
  },
  TRANSLATION_ERROR: {
    code: "TRANSLATION_ERROR",
    message: "Error translating content",
  },
  TTS_ERROR: {
    code: "TTS_ERROR",
    message: "Error generating speech",
  },
  DATABASE_ERROR: {
    code: "DATABASE_ERROR",
    message: "Database operation failed",
  },
  STORAGE_ERROR: {
    code: "STORAGE_ERROR",
    message: "Storage operation failed",
  },
  INVALID_INPUT: {
    code: "INVALID_INPUT",
    message: "Invalid input parameters",
  },
} as const;
