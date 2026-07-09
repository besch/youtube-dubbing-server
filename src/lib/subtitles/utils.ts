import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/types/subtitles";

export function buildLanguageQueryString(targetLanguage: string): string {
  // For single target language requests
  return normalizeSubtitleLanguageCode(targetLanguage);
}

export function buildFallbackLanguageQueryString(
  targetLanguage: string
): string {
  // Common languages that usually have good subtitle availability
  const commonLanguages = ["en", "es", "fr", "de", "ru"];

  // Filter out target language and get common languages as fallback
  const fallbackLanguages = commonLanguages.filter(
    (lang) =>
      lang.toLowerCase() !==
      normalizeSubtitleLanguageCode(targetLanguage).toLowerCase()
  );

  return fallbackLanguages.join(",");
}

export function buildAllLanguagesQueryString(): string {
  return SUPPORTED_LANGUAGES.join(",");
}

export function getLanguageSearchStrategy(targetLanguage: string) {
  const normalizedTargetLanguage =
    normalizeSubtitleLanguageCode(targetLanguage);
  return {
    // Step 1: Try target language only
    primary: normalizedTargetLanguage,

    // Step 2: Try common languages (good translation sources)
    fallback: buildFallbackLanguageQueryString(normalizedTargetLanguage),

    // Step 3: Try all languages as last resort
    lastResort: buildAllLanguagesQueryString(),
  };
}

export function buildSubdlUrl(
  baseUrl: string,
  apiKey: string,
  imdbID: string,
  languages: string,
  seasonNumber?: number,
  episodeNumber?: number
): string {
  let url = `${baseUrl}/subtitles?api_key=${apiKey}&imdb_id=${imdbID}&languages=${languages}`;

  if (seasonNumber !== undefined && episodeNumber !== undefined) {
    url += `&season_number=${seasonNumber}&episode_number=${episodeNumber}`;
    // Disambiguate TV episodes from movies for Subdl too.
    url += `&type=episode`;
  } else {
    url += `&type=movie`;
  }

  return url;
}

export function redactApiKey(url: string): string {
  return url.replace(/api_key=[^&]+/g, "api_key=***REDACTED***");
}

export function insertNewLineIfWrongFormattedSRT(input: string): string {
  return input.replace(/^(\d+)(\r?\n)/gm, "\n$1$2");
}

export function isTargetLanguage(
  subtitleLanguage: string,
  targetLanguage: string
): boolean {
  return (
    normalizeSubtitleLanguageCode(subtitleLanguage).toLowerCase() ===
    normalizeSubtitleLanguageCode(targetLanguage).toLowerCase()
  );
}

export function normalizeSubtitleLanguageCode(languageCode: string): string {
  const normalized = languageCode.trim().replace("_", "-").toLowerCase();
  if (normalized === "zh-cn" || normalized === "zh-tw") return "zh";
  if (normalized === "pt-pt" || normalized === "pt-br") return "pt";
  if (normalized === "fil") return "tl";
  return normalized.split("-")[0] || normalized;
}

export function createRetryDelay(attemptNumber: number): number {
  return Math.min(1000 * Math.pow(2, attemptNumber), 10000);
}

export function logSubtitleOperation(
  operation: string,
  details: Record<string, unknown>
): void {
  // Redact API keys from any URL fields
  const sanitizedDetails = { ...details };
  if (sanitizedDetails.url && typeof sanitizedDetails.url === "string") {
    sanitizedDetails.url = redactApiKey(sanitizedDetails.url);
  }

  console.log(`[Subtitle ${operation}]`, sanitizedDetails);
}

export function logSubtitleError(
  operation: string,
  error: unknown,
  context?: Record<string, unknown>
): void {
  // Redact API keys from any URL fields in context
  const sanitizedContext = context ? { ...context } : {};
  if (sanitizedContext.url && typeof sanitizedContext.url === "string") {
    sanitizedContext.url = redactApiKey(sanitizedContext.url);
  }

  console.error(`[Subtitle ${operation} Error]`, {
    error: error instanceof Error ? error.message : String(error),
    ...sanitizedContext,
  });
}
