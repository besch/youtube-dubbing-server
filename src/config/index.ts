import { z } from "zod";

// Define Zod schema for environment variables
const envSchema = z.object({
  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string(),
  SUPABASE_SERVICE_ROLE_KEY: z.string(),

  // API keys and services
  REPLICATE_API_KEY: z.string().optional(),
  REPLICATE_WEBHOOK_SECRET: z.string().optional(),
  OPENAI_API_KEY: z.string(),
  ANTHROPIC_API_KEY: z.string(),

  // URLs
  NEXT_PUBLIC_APP_URL: z.string().url(),
  DOWNLOADER_SERVICE_URL: z.string().url().optional(),
  AUDIO_SEGMENTER_URL: z.string().url().optional(),
  AUDIO_SEGMENTER_SECRET_KEY: z.string().optional(),
});

// Define constant values directly
const TTS_VOICES: string[] = [
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
];
const DEFAULT_CHUNK_DURATION = 180; // Default segment duration in seconds
const DEFAULT_PRELOAD_TIME = 60; // Default preload time in seconds
const SUPPORTED_LANGUAGES: { code: string; name: string }[] = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "hi", name: "Hindi" },
  { code: "ja", name: "Japanese" },
  { code: "pl", name: "Polish" },
  // Add more languages as needed
];
const STORAGE_REGULAR_EXPIRY = "30 days"; // Example expiry for non-favorited items
const STORAGE_FAVORITE_EXPIRY = "never"; // Example expiry for favorited items

// Validate environment variables
try {
  envSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error(
      "Environment variable validation failed:",
      error.errors.map((e) => `${e.path.join(".")}: ${e.message}`)
    );
    // Decide if you want to throw or exit process
    // throw new Error("Missing or invalid environment variables.");
    process.exit(1); // Exit if critical variables are missing
  }
  throw error; // Re-throw other errors
}

// Export validated and typed configuration
export const config = {
  supabase: {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  },
  apiKeys: {
    replicate: process.env.REPLICATE_API_KEY,
    replicateWebhookSecret: process.env.REPLICATE_WEBHOOK_SECRET,
    openai: process.env.OPENAI_API_KEY!,
    anthropic: process.env.ANTHROPIC_API_KEY!,
  },
  services: {
    downloaderUrl: process.env.DOWNLOADER_SERVICE_URL,
    segmenterUrl: process.env.AUDIO_SEGMENTER_URL,
    segmenterSecret: process.env.AUDIO_SEGMENTER_SECRET_KEY,
  },
  app: {
    url: process.env.NEXT_PUBLIC_APP_URL!,
  },
  // YouTube processing
  youtube: {
    // chunkDuration: process.env.youtube_chunkDuration as number, // Use direct value
    chunkDuration: DEFAULT_CHUNK_DURATION,
    // preloadTime: process.env.youtube_preloadTime as number, // Use direct value
    preloadTime: DEFAULT_PRELOAD_TIME,
  },

  // Storage policies - Use direct values
  storage: {
    // regularExpiry: process.env.storage_regularExpiry as string,
    regularExpiry: STORAGE_REGULAR_EXPIRY,
    // favoriteExpiry: process.env.storage_favoriteExpiry as string,
    favoriteExpiry: STORAGE_FAVORITE_EXPIRY,
  },

  // Voice options - Use direct value
  // voices: process.env.voices as string[],
  voices: TTS_VOICES,

  // Supported languages - Use direct value
  // languages: process.env.languages as { code: string; name: string }[],
  languages: SUPPORTED_LANGUAGES,
};
