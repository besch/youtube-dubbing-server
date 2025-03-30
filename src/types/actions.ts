// Define a generic structure for server action responses
// Based on next-safe-action patterns

// You can define specific application errors here
export enum AppErrorCode {
  UNEXPECTED_ERROR = "UNEXPECTED_ERROR",
  VALIDATION_FAILED = "VALIDATION_FAILED",
  DATABASE_ERROR = "DATABASE_ERROR",
  NOT_FOUND = "NOT_FOUND",
  UNAUTHORIZED = "UNAUTHORIZED",
  EXTERNAL_API_ERROR = "EXTERNAL_API_ERROR",
  // Add more specific error codes as needed
  DOWNLOAD_SERVICE_ERROR = "DOWNLOAD_SERVICE_ERROR",
  REPLICATE_ERROR = "REPLICATE_ERROR",
  OPENAI_ERROR = "OPENAI_ERROR",
  SUPABASE_STORAGE_ERROR = "SUPABASE_STORAGE_ERROR",
}

export interface AppError {
  code: AppErrorCode;
  message: string;
  details?: Record<string, unknown> | string; // Optional details
}

// Predefined common errors
export const appErrors: Record<string, AppError> = {
  UNEXPECTED_ERROR: {
    code: AppErrorCode.UNEXPECTED_ERROR,
    message: "An unexpected error occurred.",
  },
  VALIDATION_FAILED: {
    code: AppErrorCode.VALIDATION_FAILED,
    message: "Input validation failed.",
  },
  DATABASE_ERROR: {
    code: AppErrorCode.DATABASE_ERROR,
    message: "A database error occurred.",
  },
  NOT_FOUND: {
    code: AppErrorCode.NOT_FOUND,
    message: "The requested resource was not found.",
  },
  UNAUTHORIZED: {
    code: AppErrorCode.UNAUTHORIZED,
    message: "You are not authorized to perform this action.",
  },
  EXTERNAL_API_ERROR: {
    code: AppErrorCode.EXTERNAL_API_ERROR,
    message: "An error occurred while communicating with an external service.",
  },
  DOWNLOAD_SERVICE_ERROR: {
    code: AppErrorCode.DOWNLOAD_SERVICE_ERROR,
    message: "Error communicating with the download service.",
  },
  REPLICATE_ERROR: {
    code: AppErrorCode.REPLICATE_ERROR,
    message: "Error during transcription/diarization via Replicate.",
  },
  OPENAI_ERROR: {
    code: AppErrorCode.OPENAI_ERROR,
    message: "Error generating audio via OpenAI.",
  },
  SUPABASE_STORAGE_ERROR: {
    code: AppErrorCode.SUPABASE_STORAGE_ERROR,
    message: "Error interacting with Supabase Storage.",
  },
};

// Generic ActionResponse type
export type ActionResponse<T = null> =
  | { success: true; data: T }
  | { success: false; error: AppError };
