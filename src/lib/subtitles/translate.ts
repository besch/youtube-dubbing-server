import { GoogleGenerativeAI } from "@google/generative-ai";
import { createHash } from "crypto";
import { supabaseServiceRoleClient } from "@/lib/supabase/serviceRoleClient";

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

// Ordered list of supported models. Older 1.5 models are being
// deprecated by Google, so we try current GA models first and fall back
// if a model id is retired.
const GEMINI_MODEL_NAMES = [
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-1.5-flash-8b",
];

if (!GOOGLE_API_KEY) {
  console.error(
    "GOOGLE_API_KEY environment variable is not set. Translation will fail."
  );
}

const genAI = GOOGLE_API_KEY ? new GoogleGenerativeAI(GOOGLE_API_KEY) : null;

async function getModel(modelIndex = 0) {
  if (!genAI) return null;
  const name = GEMINI_MODEL_NAMES[modelIndex] ?? GEMINI_MODEL_NAMES[0];
  return genAI.getGenerativeModel({ model: name });
}

const generationConfig = {
  temperature: 0.3,
  maxOutputTokens: 4096,
};

const TRANSLATION_CACHE_BUCKET =
  process.env.TRANSLATION_CACHE_BUCKET || "generated-subtitles";

function getCacheKey(
  sourceLanguage: string,
  targetLanguage: string,
  content: string
): string {
  const hash = createHash("sha256")
    .update(`${sourceLanguage}|${targetLanguage}|${content}`)
    .digest("hex");
  return `${hash}.srt`;
}

async function getCachedTranslation(
  sourceLanguage: string,
  targetLanguage: string,
  content: string
): Promise<string | null> {
  try {
    const path = getCacheKey(sourceLanguage, targetLanguage, content);
    const { data, error } = await supabaseServiceRoleClient.storage
      .from(TRANSLATION_CACHE_BUCKET)
      .download(path);
    if (error || !data) return null;
    const buf = await data.arrayBuffer();
    return new TextDecoder().decode(buf);
  } catch {
    return null;
  }
}

async function setCachedTranslation(
  sourceLanguage: string,
  targetLanguage: string,
  content: string,
  translated: string
): Promise<void> {
  try {
    const path = getCacheKey(sourceLanguage, targetLanguage, content);
    const { error } = await supabaseServiceRoleClient.storage
      .from(TRANSLATION_CACHE_BUCKET)
      .upload(path, new TextEncoder().encode(translated), {
        contentType: "text/plain",
        upsert: true,
        cacheControl: "31536000",
      });
    if (error) {
      console.warn("translateSubtitles: cache store failed", error.message);
    }
  } catch {
    // Best-effort cache write.
  }
}

export async function translateSubtitles(
  srtContent: string,
  sourceLanguage: string,
  targetLanguage: string
): Promise<string> {
  const cached = await getCachedTranslation(
    sourceLanguage,
    targetLanguage,
    srtContent
  );
  if (cached) {
    console.log("translateSubtitles: cache hit");
    return cached;
  }

  const lines = srtContent.split("\n");
  const batches = [];
  const batchSize = 100;

  for (let i = 0; i < lines.length; i += batchSize) {
    batches.push(lines.slice(i, i + batchSize).join("\n"));
  }

  // Use Batch API for cost savings
  const translatedBatches = await Promise.all(
    batches.map((batch) =>
      translateBatch(batch, sourceLanguage, targetLanguage)
    )
  );

  const translated = translatedBatches.join("\n");
  await setCachedTranslation(
    sourceLanguage,
    targetLanguage,
    srtContent,
    translated
  );
  return translated;
}

export async function translateBatch(
  batch: string,
  sourceLanguage: string,
  targetLanguage: string,
  retries = 3
): Promise<string> {
  if (!batch) {
    console.warn("translateBatch called with empty batch.");
    return "";
  }

  try {
    const prompt = `Translate the following subtitles from "${sourceLanguage}" to "${targetLanguage}".
Maintain the exact same timing and numbering format. Respond ONLY with the translated subtitles in the specified format.
Critical formatting rules:
1. Each subtitle entry MUST be separated by exactly ONE empty line.
2. Each entry MUST follow this exact format (no brackets, no extra characters):
   [number]
   [timestamp, e.g., 00:00:20,000 --> 00:00:22,000]
   [translated text, potentially multi-line]
3. Preserve all original numbering and timing exactly as provided. Do not add any introductory text, closing remarks, or explanations. ONLY output the translated subtitle block.
4. The last subtitle entry MUST be followed by an empty line.
5. Never include multiple consecutive empty lines unless they are part of the subtitle text itself.

Original Subtitles:

${batch}`;

    // Try each supported model in order; fall back if one is retired/errors.
    let lastModelError: unknown;
    for (
      let modelIndex = 0;
      modelIndex < GEMINI_MODEL_NAMES.length;
      modelIndex++
    ) {
      const model = await getModel(modelIndex);
      if (!model) break;
      try {
        const batchRequest = {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig,
        };

        const result = await model.generateContent(batchRequest);
        const response = result.response;
        if (
          !response ||
          !response.candidates ||
          response.candidates.length === 0 ||
          !response.candidates[0].content?.parts?.[0]?.text
        ) {
          let errorMessage =
            "Gemini translation failed: Invalid response structure.";
          if (response?.promptFeedback?.blockReason) {
            errorMessage = `Gemini translation blocked: ${response.promptFeedback.blockReason}`;
            console.error(
              "Safety Ratings:",
              JSON.stringify(response.promptFeedback.safetyRatings)
            );
          }
          console.error(errorMessage, JSON.stringify(response, null, 2));
          throw new Error(errorMessage);
        }

        const finishReason = response.candidates[0].finishReason;
        if (finishReason && finishReason !== "STOP") {
          console.warn(
            `Gemini translation finished with reason: ${finishReason}. Output might be incomplete.`
          );
          if (finishReason === "MAX_TOKENS") {
            throw new Error(
              "Gemini translation failed: Max tokens reached. Output is incomplete."
            );
          }
        }

        return response.candidates[0].content.parts[0].text;
      } catch (modelError) {
        // Retry the same model a few times, then fall to the next model.
        if (retries > 0) {
          console.log(
            `Retrying translation (model ${GEMINI_MODEL_NAMES[modelIndex]})... Attempts left: ${
              retries - 1
            }. Error: ${
              modelError instanceof Error
                ? modelError.message
                : String(modelError)
            }`
          );
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return await translateBatch(
            batch,
            sourceLanguage,
            targetLanguage,
            retries - 1
          );
        }
        lastModelError = modelError;
        console.warn(
          `Gemini model ${GEMINI_MODEL_NAMES[modelIndex]} failed, trying next.`
        );
      }
    }

    console.error("All Gemini models failed for translation batch:", lastModelError);
    if (lastModelError instanceof Error) {
      throw lastModelError;
    } else {
      throw new Error("Gemini API call failed after trying all models.");
    }
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("Gemini API call failed.");
    }
  }
}

export function cleanSrtContent(srtContent: string): string {
  let entries = srtContent.split("\n\n");
  entries = entries.filter((entry) => {
    const lines = entry.split("\n");
    return lines.length < 3 || !lines[2].trim().startsWith("#");
  });
  let cleaned = entries.join("\n\n");
  cleaned = cleaned.replace(/<[^>]*>/g, "");
  cleaned = cleaned.replace(/\[.*?\]/g, "");
  cleaned = cleaned.replace(/\{\\[^}]*\}/g, "");
  cleaned = cleaned
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
  cleaned = cleaned.replace(/^\s*[\r\n]/gm, "");
  return cleaned;
}

export function formatSubtitles(srtContent: string): string {
  const lines = srtContent.split("\n");
  let formattedContent = "";
  let currentEntry = [];
  let subtitleNumber = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") {
      if (currentEntry.length >= 3) {
        formattedContent += `${subtitleNumber}\n`;
        formattedContent += `${currentEntry[1]}\n`;
        formattedContent += currentEntry.slice(2).join("\n") + "\n\n";
        subtitleNumber++;
      }
      currentEntry = [];
    } else {
      currentEntry.push(line);
    }
  }

  if (currentEntry.length >= 3) {
    formattedContent += `${subtitleNumber}\n`;
    formattedContent += `${currentEntry[1]}\n`;
    formattedContent += currentEntry.slice(2).join("\n") + "\n\n";
  }

  return formattedContent.trim();
}

export function improveSubtitleFormatting(input: string): string {
  const lines = input.split("\n");
  const formattedSubtitles = [];
  let currentSubtitle = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^\d+$/.test(line)) {
      if (currentSubtitle.length > 0) {
        formattedSubtitles.push(currentSubtitle.join("\n"));
        currentSubtitle = [];
      }
      currentSubtitle.push(line);
    } else if (line !== "") {
      currentSubtitle.push(line);
    }
  }

  if (currentSubtitle.length > 0) {
    formattedSubtitles.push(currentSubtitle.join("\n"));
  }

  return formattedSubtitles.join("\n\n");
}

const priorityLanguages = [
  "en",
  "es",
  "fr",
  "de",
  "it",
  "pt",
  "ru",
  "ja",
  "zh",
  "ko",
];

const priorityReleaseKeywords = [
  "bluray",
  "web-dl",
  "webdl",
  "webrip",
  "bdrip",
  "dvdrip",
  "hdrip",
];

export const calculateScore = (subtitle: any) => {
  let score = 0;
  const attrs = subtitle.attributes;

  if (attrs.hd) score += 5;
  score += Math.min(Math.floor(attrs.download_count / 100), 10);
  score += attrs.ratings * 2;

  const monthsOld =
    (new Date().getTime() - new Date(attrs.upload_date).getTime()) /
    (1000 * 60 * 60 * 24 * 30);
  score -= Math.min(Math.floor(monthsOld), 12);

  if (attrs.from_trusted) score += 3;

  const languageIndex = priorityLanguages.indexOf(attrs.language);
  if (languageIndex !== -1) {
    score += 5 - languageIndex;
  }

  const release = attrs.release.toLowerCase();
  for (let i = 0; i < priorityReleaseKeywords.length; i++) {
    if (release.includes(priorityReleaseKeywords[i])) {
      score += 5 - i;
      break;
    }
  }

  return score;
};
