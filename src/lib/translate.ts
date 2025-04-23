import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ReplicateSegment } from "@/lib/replicate";
import { AppError, AppErrorCode } from "@/app/actions/actions";

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GEMINI_MODEL_NAME = "gemini-2.0-flash";

if (!GOOGLE_API_KEY) {
  console.error("GOOGLE_API_KEY environment variable is not set.");
}

const genAI = GOOGLE_API_KEY ? new GoogleGenerativeAI(GOOGLE_API_KEY) : null;
const model = genAI
  ? genAI.getGenerativeModel({ model: GEMINI_MODEL_NAME })
  : null;

const generationConfig = {
  temperature: 0.3,
  topK: 1,
  topP: 1,
  maxOutputTokens: 8192,
};

/**
 * Formats transcription segments into a numbered list with timestamps for the translation prompt.
 */
export function formatTranscriptionForTranslation(
  segments: ReplicateSegment[] | undefined | null
): string {
  if (!segments || !Array.isArray(segments) || segments.length === 0) return "";
  let batch = "";
  segments.forEach((segment, index) => {
    if (
      segment &&
      typeof segment.start === "number" &&
      typeof segment.end === "number" &&
      typeof segment.text === "string"
    ) {
      batch += `${index + 1}\n`;
      batch += `${segment.start.toFixed(3)} --> ${segment.end.toFixed(3)}\n`;
      batch += `${segment.text}\n\n`; // Ensure double newline separation
    }
  });
  return batch.trimEnd(); // Trim only trailing whitespace/newlines
}

/**
 * Parses the Gemini API response text back into structured ReplicateSegments.
 */
export function parseTranslationResponse(
  responseText: string,
  originalSegments: ReplicateSegment[]
): ReplicateSegment[] | null {
  try {
    const lines = responseText.trim().split("\n");
    const translatedSegments: ReplicateSegment[] = [];
    let lineIndex = 0;
    let currentSegment: Partial<ReplicateSegment> & { index?: number } = {};

    while (lineIndex < lines.length) {
      const line = lines[lineIndex]?.trim();

      if (!line) {
        // Skip empty lines between segments
        lineIndex++;
        continue;
      }

      // 1. Try matching the index line (e.g., "1")
      const indexMatch = line.match(/^(\d+)$/);
      if (indexMatch) {
        // If we were building a segment, finalize it if it has text
        if (currentSegment.index !== undefined && currentSegment.text) {
          const originalIndex = currentSegment.index - 1;
          const original = originalSegments[originalIndex];
          if (
            original &&
            typeof original.start === "number" &&
            typeof original.end === "number"
          ) {
            translatedSegments.push({
              start: original.start,
              end: original.end,
              text: currentSegment.text.trim(), // Trim text here
              words: [], // Keep words empty for translations
            });
          } else {
            console.warn(
              `Parsing Gemini: Could not find original segment for index ${currentSegment.index} or times missing`
            );
          }
        }
        // Start a new segment
        currentSegment = { index: parseInt(indexMatch[1], 10) };
        lineIndex++;
        continue;
      }

      // 2. Try matching the timestamp line (e.g., "0.123 --> 4.567")
      const timeMatch = line.match(/^(\d+\.\d+)\s*-->\s*(\d+\.\d+)$/);
      if (timeMatch && currentSegment.index !== undefined) {
        // We already get timing from the original segment, so we just consume this line
        lineIndex++;
        continue;
      }

      // 3. Assume it's a text line
      if (currentSegment.index !== undefined) {
        currentSegment.text =
          (currentSegment.text ? currentSegment.text + "\n" : "") + line;
        lineIndex++;
      } else {
        // Unexpected line, skip it
        console.warn(`Parsing Gemini: Skipping unexpected line: "${line}"`);
        lineIndex++;
      }
    }

    // Add the last processed segment if it exists and has text
    if (currentSegment.index !== undefined && currentSegment.text) {
      const originalIndex = currentSegment.index - 1;
      const original = originalSegments[originalIndex];
      if (
        original &&
        typeof original.start === "number" &&
        typeof original.end === "number"
      ) {
        translatedSegments.push({
          start: original.start,
          end: original.end,
          text: currentSegment.text.trim(),
          words: [],
        });
      } else {
        console.warn(
          `Parsing Gemini: Could not find original segment for index ${currentSegment.index} (last segment) or times missing`
        );
      }
    }

    if (
      translatedSegments.length === 0 &&
      originalSegments.length > 0 &&
      responseText.length > 0
    ) {
      console.warn(
        `Parsing Gemini: Failed to parse any segments from non-empty response.`
      );
      return null;
    } else if (translatedSegments.length !== originalSegments.length) {
      console.warn(
        `Parsing Gemini: Mismatch in segment count. Original: ${originalSegments.length}, Translated: ${translatedSegments.length}. Raw response:\n${responseText}`
      );
      // Decide whether to return partial data or null
      // Returning partial might be better than nothing, but log aggressively.
      // return null; // Option 1: Return null on mismatch
      return translatedSegments; // Option 2: Return partial data
    }

    return translatedSegments;
  } catch (error) {
    console.error("Error parsing Gemini response:", error);
    console.error("Gemini Raw Response Text:", responseText);
    return null;
  }
}

/**
 * Calls the Gemini API to translate the provided text formatted as subtitles.
 */
export async function translateText(
  textToTranslate: string,
  targetLangName: string // Full language name (e.g., "Spanish")
): Promise<string> {
  if (!model) {
    throw new AppError(
      AppErrorCode.CONFIGURATION_ERROR,
      "Gemini AI model not initialized. Check API Key."
    );
  }
  if (!textToTranslate) {
    console.warn("translateText called with empty input.");
    return "";
  }

  // Updated prompt: Removed source language specification
  const prompt = `Translate the following subtitles to ${targetLangName}.
Detect the source language automatically.
Maintain the exact same timing and numbering format. Respond ONLY with the translated subtitles in the specified format.
Critical formatting rules:
1. Each subtitle entry MUST be separated by exactly ONE empty line.
2. Each entry MUST follow this exact format (no brackets, no extra characters):
[number]
[start_time in seconds.milliseconds --> end_time in seconds.milliseconds]
[translated text, potentially multi-line]

3. Preserve all original numbering and timing exactly as provided. Do not add any introductory text, closing remarks, or explanations. ONLY output the translated subtitle block.

Original Subtitles:

${textToTranslate}
`;

  try {
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig,
    });

    const response = result.response;
    if (
      !response ||
      !response.candidates ||
      response.candidates.length === 0 ||
      !response.candidates[0].content?.parts?.[0]?.text
    ) {
      // Log safety ratings if available
      if (response?.promptFeedback?.blockReason) {
        console.error(
          `Gemini translation blocked. Reason: ${response.promptFeedback.blockReason}`
        );
        console.error(
          "Safety Ratings:",
          JSON.stringify(response.promptFeedback.safetyRatings)
        );
        throw new AppError(
          AppErrorCode.SERVICE_ERROR,
          `Gemini translation blocked: ${response.promptFeedback.blockReason}`
        );
      } else {
        console.error(
          "Gemini translation failed: Invalid response structure.",
          JSON.stringify(response, null, 2)
        );
        throw new AppError(
          AppErrorCode.SERVICE_ERROR,
          "Gemini translation failed: Invalid response structure."
        );
      }
    }

    // Check finish reason
    const finishReason = response.candidates[0].finishReason;
    if (finishReason && finishReason !== "STOP") {
      console.warn(
        `Gemini translation finished with reason: ${finishReason}. Output might be incomplete.`
      );
      // Potentially throw an error or handle based on the reason (e.g., MAX_TOKENS)
    }

    const translatedText = response.candidates[0].content.parts[0].text;
    return translatedText;
  } catch (error: any) {
    console.error("Error calling Gemini API:", error);
    // Check if it's a GoogleGenerativeAI error for more details
    if (error?.message) {
      throw new AppError(
        AppErrorCode.SERVICE_ERROR,
        `Gemini API error: ${error.message}`
      );
    } else {
      throw new AppError(AppErrorCode.SERVICE_ERROR, "Gemini API call failed.");
    }
  }
}

/**
 * Calls the Gemini API to translate a simple string of text.
 */
export async function translateSimpleText(
  textToTranslate: string,
  targetLangName: string // Full language name (e.g., "Spanish")
): Promise<string> {
  if (!model) {
    throw new AppError(
      AppErrorCode.CONFIGURATION_ERROR,
      "Gemini AI model not initialized. Check API Key."
    );
  }
  if (!textToTranslate) {
    console.warn("translateSimpleText called with empty input.");
    return "";
  }

  // Updated prompt: Removed source language specification
  const prompt = `Translate the following text to ${targetLangName}.
Detect the source language automatically.
Respond ONLY with the translated text, without any additional formatting or explanations.

Text:
"${textToTranslate}"
`;

  try {
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig,
    });

    const response = result.response;
    if (
      !response ||
      !response.candidates ||
      response.candidates.length === 0 ||
      !response.candidates[0].content?.parts?.[0]?.text
    ) {
      if (response?.promptFeedback?.blockReason) {
        console.error(
          `Gemini simple translation blocked. Reason: ${response.promptFeedback.blockReason}`
        );
        throw new AppError(
          AppErrorCode.SERVICE_ERROR,
          `Gemini translation blocked: ${response.promptFeedback.blockReason}`
        );
      } else {
        console.error(
          "Gemini simple translation failed: Invalid response structure.",
          JSON.stringify(response, null, 2)
        );
        throw new AppError(
          AppErrorCode.SERVICE_ERROR,
          "Gemini translation failed: Invalid response structure."
        );
      }
    }

    const finishReason = response.candidates[0].finishReason;
    if (finishReason && finishReason !== "STOP") {
      console.warn(
        `Gemini simple translation finished with reason: ${finishReason}. Output might be incomplete.`
      );
    }

    const translatedText = response.candidates[0].content.parts[0].text.trim();
    // Remove potential quotes sometimes added by the model
    return translatedText.replace(/^"|"$/g, "");
  } catch (error: any) {
    console.error("Error calling Gemini API for simple translation:", error);
    if (error?.message) {
      throw new AppError(
        AppErrorCode.SERVICE_ERROR,
        `Gemini API error: ${error.message}`
      );
    } else {
      throw new AppError(AppErrorCode.SERVICE_ERROR, "Gemini API call failed.");
    }
  }
}
