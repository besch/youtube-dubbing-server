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
  GOOGLE_API_KEY: z.string(), // Use API Key directly

  // URLs
  NEXT_PUBLIC_APP_URL: z.string().url(),
  DOWNLOADER_SERVICE_URL: z.string().url().optional(),
  AUDIO_SEGMENTER_URL: z.string().url().optional(),
  AUDIO_SEGMENTER_SECRET_KEY: z.string().optional(),
});

// Define constant values directly
const OPENAI_TTS_VOICES: string[] = [
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
];

// Google TTS Configuration
const DEFAULT_GOOGLE_SPEAKING_RATE = 1.1;
// BCP-47 language codes mapped to English names and standard voices
// Ref: https://cloud.google.com/text-to-speech/docs/voices
// Using only Standard voices for cost-effectiveness
const GOOGLE_TTS_LANGUAGES: Record<
  string,
  { name: string; voices: GoogleVoiceInfo[] }
> = {
  "ar-XA": {
    name: "Arabic (multi-region)",
    voices: [
      { id: "ar-XA-Standard-A", gender: "FEMALE", displayName: "Female" },
      { id: "ar-XA-Standard-B", gender: "MALE", displayName: "Male 1" },
      { id: "ar-XA-Standard-C", gender: "MALE", displayName: "Male 2" },
      { id: "ar-XA-Standard-D", gender: "FEMALE", displayName: "Female 2" },
    ],
  },
  "id-ID": {
    name: "Indonesian (Indonesia)",
    voices: [
      { id: "id-ID-Standard-A", gender: "FEMALE", displayName: "Female" },
      { id: "id-ID-Standard-B", gender: "MALE", displayName: "Male 1" },
      { id: "id-ID-Standard-C", gender: "MALE", displayName: "Male 2" },
      { id: "id-ID-Standard-D", gender: "FEMALE", displayName: "Female 2" },
    ],
  },
  "de-DE": {
    name: "German (Germany)",
    voices: [
      { id: "de-DE-Standard-A", gender: "FEMALE", displayName: "Female" },
      { id: "de-DE-Standard-B", gender: "MALE", displayName: "Male" },
      { id: "de-DE-Standard-E", gender: "MALE", displayName: "Male (Neural2)" },
      {
        id: "de-DE-Standard-F",
        gender: "FEMALE",
        displayName: "Female (Neural2)",
      },
    ],
  }, // Note: E/F are Neural2, potentially different pricing? Sticking to Standard A/B for now might be safer if avoiding Neural2. Assuming standard voices are A/B/C/D.
  "en-AU": {
    name: "English (Australia)",
    voices: [
      { id: "en-AU-Standard-A", gender: "FEMALE", displayName: "Female 1" },
      { id: "en-AU-Standard-B", gender: "MALE", displayName: "Male" },
      { id: "en-AU-Standard-C", gender: "FEMALE", displayName: "Female 2" },
      { id: "en-AU-Standard-D", gender: "MALE", displayName: "Male 2" },
    ],
  },
  "en-GB": {
    name: "English (Great Britain)",
    voices: [
      { id: "en-GB-Standard-A", gender: "FEMALE", displayName: "Female 1" },
      { id: "en-GB-Standard-B", gender: "MALE", displayName: "Male" },
      { id: "en-GB-Standard-C", gender: "FEMALE", displayName: "Female 2" },
      { id: "en-GB-Standard-D", gender: "MALE", displayName: "Male 2" },
    ],
  },
  "en-IN": {
    name: "English (India)",
    voices: [
      { id: "en-IN-Standard-A", gender: "FEMALE", displayName: "Female 1" },
      { id: "en-IN-Standard-B", gender: "MALE", displayName: "Male" },
      { id: "en-IN-Standard-C", gender: "FEMALE", displayName: "Female 2" },
      { id: "en-IN-Standard-D", gender: "MALE", displayName: "Male 2" },
    ],
  },
  "en-US": {
    name: "English (United States)",
    voices: [
      { id: "en-US-Standard-A", gender: "MALE", displayName: "Male 1" },
      { id: "en-US-Standard-B", gender: "MALE", displayName: "Male 2" },
      { id: "en-US-Standard-C", gender: "FEMALE", displayName: "Female 1" },
      { id: "en-US-Standard-D", gender: "FEMALE", displayName: "Female 2" },
      { id: "en-US-Standard-E", gender: "FEMALE", displayName: "Female 3" },
      { id: "en-US-Standard-F", gender: "FEMALE", displayName: "Female 4" },
      { id: "en-US-Standard-G", gender: "FEMALE", displayName: "Female 5" },
      { id: "en-US-Standard-H", gender: "FEMALE", displayName: "Female 6" },
      { id: "en-US-Standard-I", gender: "MALE", displayName: "Male 3" },
      { id: "en-US-Standard-J", gender: "MALE", displayName: "Male 4" },
    ],
  },
  "es-ES": {
    name: "Spanish (Spain)",
    voices: [
      { id: "es-ES-Standard-A", gender: "FEMALE", displayName: "Female" },
      { id: "es-ES-Standard-B", gender: "MALE", displayName: "Male" },
      { id: "es-ES-Standard-C", gender: "FEMALE", displayName: "Female 2" },
      { id: "es-ES-Standard-D", gender: "FEMALE", displayName: "Female 3" },
    ],
  },
  "es-US": {
    name: "Spanish (United States)",
    voices: [
      { id: "es-US-Standard-A", gender: "FEMALE", displayName: "Female" },
      { id: "es-US-Standard-B", gender: "MALE", displayName: "Male" },
      { id: "es-US-Standard-C", gender: "MALE", displayName: "Male 2" },
    ],
  }, // Note: Assuming Standard A/B/C. Check official list if needed.
  "fr-CA": {
    name: "French (Canada)",
    voices: [
      { id: "fr-CA-Standard-A", gender: "FEMALE", displayName: "Female 1" },
      { id: "fr-CA-Standard-B", gender: "MALE", displayName: "Male" },
      { id: "fr-CA-Standard-C", gender: "FEMALE", displayName: "Female 2" },
      { id: "fr-CA-Standard-D", gender: "MALE", displayName: "Male 2" },
    ],
  },
  "fr-FR": {
    name: "French (France)",
    voices: [
      { id: "fr-FR-Standard-A", gender: "FEMALE", displayName: "Female 1" },
      { id: "fr-FR-Standard-B", gender: "MALE", displayName: "Male" },
      { id: "fr-FR-Standard-C", gender: "FEMALE", displayName: "Female 2" },
      { id: "fr-FR-Standard-D", gender: "MALE", displayName: "Male 2" },
      { id: "fr-FR-Standard-E", gender: "FEMALE", displayName: "Female 3" },
    ],
  },
  "it-IT": {
    name: "Italian (Italy)",
    voices: [
      { id: "it-IT-Standard-A", gender: "FEMALE", displayName: "Female 1" },
      { id: "it-IT-Standard-B", gender: "FEMALE", displayName: "Female 2" },
      { id: "it-IT-Standard-C", gender: "MALE", displayName: "Male" },
      { id: "it-IT-Standard-D", gender: "MALE", displayName: "Male 2" },
    ],
  },
  "nl-NL": {
    name: "Dutch (Netherlands)",
    voices: [
      { id: "nl-NL-Standard-A", gender: "FEMALE", displayName: "Female 1" },
      { id: "nl-NL-Standard-B", gender: "MALE", displayName: "Male" },
      { id: "nl-NL-Standard-C", gender: "MALE", displayName: "Male 2" },
      { id: "nl-NL-Standard-D", gender: "FEMALE", displayName: "Female 2" },
      { id: "nl-NL-Standard-E", gender: "FEMALE", displayName: "Female 3" },
    ],
  },
  "pl-PL": {
    name: "Polish (Poland)",
    voices: [
      { id: "pl-PL-Standard-A", gender: "FEMALE", displayName: "Female 1" },
      { id: "pl-PL-Standard-B", gender: "MALE", displayName: "Male" },
      { id: "pl-PL-Standard-C", gender: "MALE", displayName: "Male 2" },
      { id: "pl-PL-Standard-D", gender: "FEMALE", displayName: "Female 2" },
      { id: "pl-PL-Standard-E", gender: "FEMALE", displayName: "Female 3" },
    ],
  },
  "pt-BR": {
    name: "Portuguese (Brazil)",
    voices: [
      { id: "pt-BR-Standard-A", gender: "FEMALE", displayName: "Female" },
      { id: "pt-BR-Standard-B", gender: "MALE", displayName: "Male" },
      { id: "pt-BR-Standard-C", gender: "FEMALE", displayName: "Female 2" },
    ],
  },
  "vi-VN": {
    name: "Vietnamese (Vietnam)",
    voices: [
      { id: "vi-VN-Standard-A", gender: "FEMALE", displayName: "Female 1" },
      { id: "vi-VN-Standard-B", gender: "MALE", displayName: "Male" },
      { id: "vi-VN-Standard-C", gender: "FEMALE", displayName: "Female 2" },
      { id: "vi-VN-Standard-D", gender: "MALE", displayName: "Male 2" },
    ],
  },
  "tr-TR": {
    name: "Turkish (Turkey)",
    voices: [
      { id: "tr-TR-Standard-A", gender: "FEMALE", displayName: "Female 1" },
      { id: "tr-TR-Standard-B", gender: "MALE", displayName: "Male" },
      { id: "tr-TR-Standard-C", gender: "FEMALE", displayName: "Female 2" },
      { id: "tr-TR-Standard-D", gender: "FEMALE", displayName: "Female 3" },
      { id: "tr-TR-Standard-E", gender: "MALE", displayName: "Male 2" },
    ],
  },
  "ru-RU": {
    name: "Russian (Russia)",
    voices: [
      { id: "ru-RU-Standard-A", gender: "FEMALE", displayName: "Female 1" },
      { id: "ru-RU-Standard-B", gender: "MALE", displayName: "Male" },
      { id: "ru-RU-Standard-C", gender: "FEMALE", displayName: "Female 2" },
      { id: "ru-RU-Standard-D", gender: "MALE", displayName: "Male 2" },
      { id: "ru-RU-Standard-E", gender: "FEMALE", displayName: "Female 3" },
    ],
  },
  "mr-IN": {
    name: "Marathi (India)",
    voices: [
      { id: "mr-IN-Standard-A", gender: "FEMALE", displayName: "Female" },
      { id: "mr-IN-Standard-B", gender: "MALE", displayName: "Male" },
      { id: "mr-IN-Standard-C", gender: "FEMALE", displayName: "Female 2" },
    ],
  },
  "hi-IN": {
    name: "Hindi (India)",
    voices: [
      { id: "hi-IN-Standard-A", gender: "FEMALE", displayName: "Female 1" },
      { id: "hi-IN-Standard-B", gender: "MALE", displayName: "Male" },
      { id: "hi-IN-Standard-C", gender: "FEMALE", displayName: "Female 2" },
      { id: "hi-IN-Standard-D", gender: "MALE", displayName: "Male 2" },
    ],
  },
  "bn-IN": {
    name: "Bengali (India)",
    voices: [
      { id: "bn-IN-Standard-A", gender: "FEMALE", displayName: "Female" },
      { id: "bn-IN-Standard-B", gender: "MALE", displayName: "Male" },
    ],
  },
  "gu-IN": {
    name: "Gujarati (India)",
    voices: [
      { id: "gu-IN-Standard-A", gender: "FEMALE", displayName: "Female" },
      { id: "gu-IN-Standard-B", gender: "MALE", displayName: "Male" },
    ],
  },
  "ta-IN": {
    name: "Tamil (India)",
    voices: [
      { id: "ta-IN-Standard-A", gender: "FEMALE", displayName: "Female 1" },
      { id: "ta-IN-Standard-B", gender: "MALE", displayName: "Male" },
      { id: "ta-IN-Standard-C", gender: "FEMALE", displayName: "Female 2" },
      { id: "ta-IN-Standard-D", gender: "MALE", displayName: "Male 2" },
    ],
  },
  "te-IN": {
    name: "Telugu (India)",
    voices: [
      { id: "te-IN-Standard-A", gender: "FEMALE", displayName: "Female" },
      { id: "te-IN-Standard-B", gender: "MALE", displayName: "Male" },
    ],
  },
  "kn-IN": {
    name: "Kannada (India)",
    voices: [
      { id: "kn-IN-Standard-A", gender: "FEMALE", displayName: "Female" },
      { id: "kn-IN-Standard-B", gender: "MALE", displayName: "Male" },
    ],
  },
  "ml-IN": {
    name: "Malayalam (India)",
    voices: [
      { id: "ml-IN-Standard-A", gender: "FEMALE", displayName: "Female" },
      { id: "ml-IN-Standard-B", gender: "MALE", displayName: "Male" },
    ],
  },
  "th-TH": {
    name: "Thai (Thailand)",
    voices: [
      {
        id: "th-TH-Standard-A",
        gender: "FEMALE",
        displayName: "Female (Neural)",
      },
    ],
  }, // Seems only Neural standard exists? Confirm pricing.
  "ja-JP": {
    name: "Japanese (Japan)",
    voices: [
      { id: "ja-JP-Standard-A", gender: "FEMALE", displayName: "Female 1" },
      { id: "ja-JP-Standard-B", gender: "FEMALE", displayName: "Female 2" },
      { id: "ja-JP-Standard-C", gender: "MALE", displayName: "Male" },
      { id: "ja-JP-Standard-D", gender: "MALE", displayName: "Male 2" },
    ],
  },
  "cmn-CN": {
    name: "Mandarin Chinese (China)",
    voices: [
      { id: "cmn-CN-Standard-A", gender: "FEMALE", displayName: "Female 1" },
      { id: "cmn-CN-Standard-B", gender: "MALE", displayName: "Male" },
      { id: "cmn-CN-Standard-C", gender: "MALE", displayName: "Male 2" },
      { id: "cmn-CN-Standard-D", gender: "FEMALE", displayName: "Female 2" },
    ],
  },
  "ko-KR": {
    name: "Korean (South Korea)",
    voices: [
      { id: "ko-KR-Standard-A", gender: "FEMALE", displayName: "Female 1" },
      { id: "ko-KR-Standard-B", gender: "FEMALE", displayName: "Female 2" },
      { id: "ko-KR-Standard-C", gender: "MALE", displayName: "Male" },
      { id: "ko-KR-Standard-D", gender: "MALE", displayName: "Male 2" },
    ],
  },
};

// Map simple 2-letter codes (used in UI/DB) to Google's BCP-47 codes if needed
const simpleToGoogleLangCode: Record<string, string> = {
  ar: "ar-XA",
  id: "id-ID",
  de: "de-DE",
  en: "en-US", // Default English to US
  es: "es-ES", // Default Spanish to Spain
  fr: "fr-FR", // Default French to France
  it: "it-IT",
  nl: "nl-NL",
  pl: "pl-PL",
  pt: "pt-BR", // Default Portuguese to Brazil
  vi: "vi-VN",
  tr: "tr-TR",
  ru: "ru-RU",
  mr: "mr-IN",
  hi: "hi-IN",
  bn: "bn-IN",
  gu: "gu-IN",
  ta: "ta-IN",
  te: "te-IN",
  kn: "kn-IN",
  ml: "ml-IN",
  th: "th-TH",
  ja: "ja-JP",
  zh: "cmn-CN", // Assuming 'zh' maps to Mandarin Chinese
  ko: "ko-KR",
  // Add mappings for the specific English/Spanish variants if needed, e.g.,
  // "en-GB": "en-GB", "es-US": "es-US", "fr-CA": "fr-CA"
};

interface GoogleVoiceInfo {
  id: string;
  gender: "MALE" | "FEMALE" | "NEUTRAL";
  displayName: string; // User-friendly name like "Female 1", "Male"
}

const DEFAULT_CHUNK_DURATION = 180; // Default segment duration in seconds
const DEFAULT_PRELOAD_TIME = 60; // Default preload time in seconds
const SUPPORTED_LANGUAGES: { code: string; name: string }[] = [
  { code: "ar", name: "Arabic" },
  { code: "id", name: "Indonesian" },
  { code: "de", name: "German" },
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "it", name: "Italian" },
  { code: "nl", name: "Dutch" },
  { code: "pl", name: "Polish" },
  { code: "pt", name: "Portuguese" },
  { code: "vi", name: "Vietnamese" },
  { code: "tr", name: "Turkish" },
  { code: "ru", name: "Russian" },
  { code: "mr", name: "Marathi" },
  { code: "hi", name: "Hindi" },
  { code: "bn", name: "Bengali" },
  { code: "gu", name: "Gujarati" },
  { code: "ta", name: "Tamil" },
  { code: "te", name: "Telugu" },
  { code: "kn", name: "Kannada" },
  { code: "ml", name: "Malayalam" },
  { code: "th", name: "Thai" },
  { code: "ja", name: "Japanese" },
  { code: "zh", name: "Chinese (Mandarin)" },
  { code: "ko", name: "Korean" },
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
    googleApiKey: process.env.GOOGLE_API_KEY!, // Add API key
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
    chunkDuration: DEFAULT_CHUNK_DURATION,
    preloadTime: DEFAULT_PRELOAD_TIME,
  },

  // Storage policies - Use direct values
  storage: {
    regularExpiry: STORAGE_REGULAR_EXPIRY,
    favoriteExpiry: STORAGE_FAVORITE_EXPIRY,
  },

  // OpenAI Voice options
  openai: {
    voices: OPENAI_TTS_VOICES,
  },

  // Google TTS options
  google: {
    languages: GOOGLE_TTS_LANGUAGES,
    simpleToGoogleMap: simpleToGoogleLangCode,
    defaultSpeakingRate: DEFAULT_GOOGLE_SPEAKING_RATE,
  },

  // Supported languages for the UI (used in multiple places)
  languages: SUPPORTED_LANGUAGES,
};

// Helper type for Google Voices
// export type GoogleVoiceInfo = typeof config.google.languages[keyof typeof config.google.languages]['voices'][number];
