import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/types/subtitles";

export function buildLanguageQueryString(targetLanguage: string): string {
  // For single target language requests
  return targetLanguage;
}

export function buildFallbackLanguageQueryString(
  targetLanguage: string
): string {
  // Common languages that usually have good subtitle availability
  const commonLanguages = ["en", "es", "fr", "de", "ru"];

  // Filter out target language and get common languages as fallback
  const fallbackLanguages = commonLanguages.filter(
    (lang) => lang.toLowerCase() !== targetLanguage.toLowerCase()
  );

  return fallbackLanguages.join(",");
}

export function buildAllLanguagesQueryString(): string {
  return SUPPORTED_LANGUAGES.join(",");
}

export function getLanguageSearchStrategy(targetLanguage: string) {
  return {
    // Step 1: Try target language only
    primary: targetLanguage,

    // Step 2: Try common languages (good translation sources)
    fallback: buildFallbackLanguageQueryString(targetLanguage),

    // Step 3: Try all languages as last resort
    lastResort: buildAllLanguagesQueryString(),
  };
}

export function insertNewLineIfWrongFormattedSRT(input: string): string {
  return input.replace(/^(\d+)(\r?\n)/gm, "\n$1$2");
}

export function isTargetLanguage(
  subtitleLanguage: string,
  targetLanguage: string
): boolean {
  return subtitleLanguage.toLowerCase() === targetLanguage.toLowerCase();
}

export function logSubtitleOperation(
  operation: string,
  details: Record<string, unknown>
): void {
  console.log(`[Subtitle ${operation}]`, details);
}

export function logSubtitleError(
  operation: string,
  error: unknown,
  context?: Record<string, unknown>
): void {
  console.error(`[Subtitle ${operation} Error]`, {
    error: error instanceof Error ? error.message : String(error),
    ...context,
  });
}
