// Define specific error codes for your application
export enum AppErrorCode {
  // General Errors (1000-1999)
  UNEXPECTED_ERROR = 1000,
  VALIDATION_ERROR = 1001,
  INVALID_INPUT = 1002,
  CONFIGURATION_ERROR = 1003,

  // Authentication/Authorization Errors (2000-2999)
  UNAUTHENTICATED = 2001,
  UNAUTHORIZED = 2002,
  FORBIDDEN = 2003,

  // Database Errors (3000-3999)
  DATABASE_ERROR = 3000,
  RECORD_NOT_FOUND = 3001,
  UNIQUE_CONSTRAINT_VIOLATION = 3002,

  // External API Errors (4000-4999)
  DOWNLOADER_SERVICE_ERROR = 4000,
  REPLICATE_API_ERROR = 4001,
  OPENAI_API_ERROR = 4002,
  SUPABASE_STORAGE_ERROR = 4003,
  VIDEO_NOT_FOUND = 4004,
  AUDIO_SEGMENTER_ERROR = 4005,
  SERVICE_ERROR = 4006,

  // Video Processing Errors (5000-5999)
  VIDEO_PROCESSING_FAILED = 5000,
  TRANSCRIPTION_FAILED = 5001,
  AUDIO_GENERATION_FAILED = 5002,
  JOB_STATUS_ERROR = 5003,

  // New errors
  TRANSLATION_NOT_AVAILABLE = 6000,

  // New errors for auth admin actions
  AUTH_OPERATION_FAILED = 7000,

  // New errors for translation and TTS
  TRANSLATION_FAILED = 6002,
  TTS_FAILED = 7000,
  STORAGE_UPLOAD_FAILED = 8000,
  STORAGE_DOWNLOAD_FAILED = 8001,
  STORAGE_DELETE_FAILED = 8002,
  DEPENDENCY_NOT_READY = 9000, // Added for missing transcript/translation
}

// Custom error class for application-specific errors
export class AppError extends Error {
  public readonly code: AppErrorCode;

  constructor(code: AppErrorCode, message?: string) {
    super(message || AppErrorCode[code] || "An application error occurred");
    this.code = code;
    this.name = "AppError";
    // Ensure the prototype chain is correct
    Object.setPrototypeOf(this, new.target.prototype);
  }

  // Optional: Add a method to serialize the error for API responses
  toJSON() {
    return {
      code: this.code,
      name: this.name,
      message: this.message,
    };
  }
}

// Pre-defined common application errors
export const appErrors = {
  UNEXPECTED_ERROR: new AppError(
    AppErrorCode.UNEXPECTED_ERROR,
    "An unexpected internal error occurred."
  ),
  VALIDATION_ERROR: new AppError(
    AppErrorCode.VALIDATION_ERROR,
    "Input validation failed."
  ),
  INVALID_INPUT: new AppError(
    AppErrorCode.INVALID_INPUT,
    "Invalid input provided."
  ),
  UNAUTHENTICATED: new AppError(
    AppErrorCode.UNAUTHENTICATED,
    "User is not authenticated."
  ),
  UNAUTHORIZED: new AppError(
    AppErrorCode.UNAUTHORIZED,
    "User is not authorized to perform this action."
  ),
  FORBIDDEN: new AppError(AppErrorCode.FORBIDDEN, "Access forbidden."),
  DATABASE_ERROR: new AppError(
    AppErrorCode.DATABASE_ERROR,
    "A database error occurred."
  ),
  RECORD_NOT_FOUND: new AppError(
    AppErrorCode.RECORD_NOT_FOUND,
    "The requested record was not found."
  ),
  DOWNLOADER_SERVICE_ERROR: new AppError(
    AppErrorCode.DOWNLOADER_SERVICE_ERROR,
    "Error communicating with downloader service."
  ),
  REPLICATE_API_ERROR: new AppError(
    AppErrorCode.REPLICATE_API_ERROR,
    "Error calling Replicate API."
  ),
  OPENAI_API_ERROR: new AppError(
    AppErrorCode.OPENAI_API_ERROR,
    "Error calling OpenAI API."
  ),
  SUPABASE_STORAGE_ERROR: new AppError(
    AppErrorCode.SUPABASE_STORAGE_ERROR,
    "Error interacting with Supabase Storage."
  ),
  VIDEO_NOT_FOUND: new AppError(
    AppErrorCode.VIDEO_NOT_FOUND,
    "The requested video was not found on YouTube."
  ),
  VIDEO_PROCESSING_FAILED: new AppError(
    AppErrorCode.VIDEO_PROCESSING_FAILED,
    "Video processing failed."
  ),
  TRANSCRIPTION_FAILED: new AppError(
    AppErrorCode.TRANSCRIPTION_FAILED,
    "Transcription job failed or returned an error."
  ),
  AUDIO_GENERATION_FAILED: new AppError(
    AppErrorCode.AUDIO_GENERATION_FAILED,
    "Audio generation failed."
  ),
  JOB_STATUS_ERROR: new AppError(
    AppErrorCode.JOB_STATUS_ERROR,
    "Error retrieving job status."
  ),
  CONFIGURATION_ERROR: new AppError(
    AppErrorCode.CONFIGURATION_ERROR,
    "Server configuration error."
  ),
  AUDIO_SEGMENTER_ERROR: new AppError(
    AppErrorCode.AUDIO_SEGMENTER_ERROR,
    "Error communicating with Audio Segmenter service."
  ),
  SERVICE_ERROR: new AppError(
    AppErrorCode.SERVICE_ERROR,
    "An external service call failed."
  ),
  TRANSLATION_NOT_AVAILABLE: new AppError(
    AppErrorCode.TRANSLATION_NOT_AVAILABLE,
    "Translation for the requested language is not available yet."
  ),
  AUTH_OPERATION_FAILED: new AppError(
    AppErrorCode.AUTH_OPERATION_FAILED,
    "User authentication operation failed."
  ),
};

// Define the standard structure for server action responses
// This aligns with next-safe-action's expected output format when using handleReturnedServerError
export interface ActionResponse<T = null> {
  success: boolean;
  data?: T; // Data is present on success
  error?: AppError; // AppError (or subclass) is present on failure
}
