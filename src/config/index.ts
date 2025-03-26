export const config = {
  // API keys and services
  openai: {
    apiKey: process.env.OPENAI_API_KEY as string,
  },
  replicate: {
    apiKey: process.env.REPLICATE_API_KEY as string,
  },
  supabase: {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  },
  aws: {
    region: process.env.AWS_REGION || "us-east-1",
    lambdaFunctionName:
      process.env.AWS_LAMBDA_FUNCTION_NAME || "youtube-extractor",
    s3BucketName: process.env.S3_BUCKET_NAME || "youtube-dubbing-audio",
    apiGatewayUrl: process.env.AWS_API_GATEWAY_URL,
  },

  // YouTube processing
  youtube: {
    chunkDuration: 5 * 60, // 5 minutes in seconds
    preloadTime: 5, // seconds to generate audio before it's needed
  },

  // Storage policies
  storage: {
    regularExpiry: "24 hours", // Regular content expires after 24 hours
    favoriteExpiry: "30 days", // Favorited content expires after 30 days
  },

  // Voice options
  voices: ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const,

  // Supported languages
  languages: [
    { code: "en", name: "English" },
    { code: "es", name: "Spanish" },
    { code: "fr", name: "French" },
    { code: "de", name: "German" },
    { code: "it", name: "Italian" },
    { code: "pt", name: "Portuguese" },
    { code: "ru", name: "Russian" },
    { code: "ja", name: "Japanese" },
    { code: "zh", name: "Chinese" },
    { code: "ko", name: "Korean" },
    { code: "ar", name: "Arabic" },
  ],
};
