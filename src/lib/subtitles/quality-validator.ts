import { GoogleGenerativeAI } from "@google/generative-ai";
import { AppError, AppErrorCode } from "@/app/actions/actions";
import { logSubtitleOperation, logSubtitleError } from "./utils";

export interface SubtitleQualityResult {
  isValid: boolean;
  detectedLanguage: string;
  confidence: number;
  issues: string[];
  reason?: string;
}

export interface SubtitleValidationOptions {
  content: string;
  expectedLanguage: string;
  maxSampleLength?: number;
}

export class SubtitleQualityValidator {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor() {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new AppError(
        AppErrorCode.CONFIGURATION_ERROR,
        "Google API key is not configured for subtitle validation."
      );
    }

    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({
      model: "gemini-2.0-flash-lite",
    });
  }

  async validateSubtitleQuality(
    options: SubtitleValidationOptions
  ): Promise<SubtitleQualityResult> {
    const { content, expectedLanguage, maxSampleLength = 2000 } = options;

    logSubtitleOperation("QualityValidation_Start", {
      expectedLanguage,
      contentLength: content.length,
      maxSampleLength,
    });

    try {
      // Extract a representative sample from the subtitle content
      const sample = this.extractSubtitleSample(content, maxSampleLength);

      if (!sample.trim()) {
        return {
          isValid: false,
          detectedLanguage: "unknown",
          confidence: 0,
          issues: ["Empty or invalid subtitle content"],
          reason: "No readable text content found in subtitles",
        };
      }

      // Create the validation prompt
      const prompt = this.createValidationPrompt(sample, expectedLanguage);

      // Call Gemini API
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      // Parse the response
      const validationResult = this.parseValidationResponse(
        text,
        expectedLanguage
      );

      logSubtitleOperation("QualityValidation_Success", {
        expectedLanguage,
        detectedLanguage: validationResult.detectedLanguage,
        confidence: validationResult.confidence,
        isValid: validationResult.isValid,
        issueCount: validationResult.issues.length,
      });

      return validationResult;
    } catch (error) {
      logSubtitleError("QualityValidation_Error", error, {
        expectedLanguage,
        contentLength: content.length,
      });

      // Return a fallback result that allows processing to continue
      return {
        isValid: true, // Default to valid to avoid blocking
        detectedLanguage: expectedLanguage,
        confidence: 0.5,
        issues: [
          `Validation failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ],
        reason: "Could not validate due to API error, proceeding with caution",
      };
    }
  }

  private extractSubtitleSample(content: string, maxLength: number): string {
    // Parse SRT content and extract text from multiple subtitle entries
    const srtBlocks = content.split(/\n\s*\n/).filter((block) => block.trim());
    const textLines: string[] = [];

    for (const block of srtBlocks) {
      const lines = block.split("\n").filter((line) => line.trim());

      // Skip sequence number and timestamp lines, get actual subtitle text
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Skip if it's a sequence number (just digits)
        if (/^\d+$/.test(line)) continue;

        // Skip if it's a timestamp line
        if (
          /\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,\.]\d{3}/.test(
            line
          )
        )
          continue;

        // This should be subtitle text
        if (line.length > 0) {
          textLines.push(line);
        }
      }

      // Stop if we have enough content
      if (textLines.join(" ").length >= maxLength) break;
    }

    const sample = textLines.join(" ").substring(0, maxLength);

    logSubtitleOperation("QualityValidation_SampleExtracted", {
      originalLength: content.length,
      sampleLength: sample.length,
      blockCount: srtBlocks.length,
      textLineCount: textLines.length,
    });

    return sample;
  }

  private createValidationPrompt(
    sample: string,
    expectedLanguage: string
  ): string {
    const languageNames: Record<string, string> = {
      en: "English",
      es: "Spanish",
      fr: "French",
      de: "German",
      it: "Italian",
      pt: "Portuguese",
      ru: "Russian",
      ja: "Japanese",
      zh: "Chinese",
      ko: "Korean",
      ar: "Arabic",
      hi: "Hindi",
      nl: "Dutch",
      sv: "Swedish",
      no: "Norwegian",
      da: "Danish",
      fi: "Finnish",
      pl: "Polish",
      tr: "Turkish",
      he: "Hebrew",
    };

    const expectedLanguageName =
      languageNames[expectedLanguage] || expectedLanguage;

    return `You are a language detector for subtitles. Your PRIMARY task is to identify the language of the text.

FOCUS ONLY ON LANGUAGE DETECTION - ignore minor quality issues like repetition, stuttering, or informal speech patterns.

Expected Language: ${expectedLanguageName} (${expectedLanguage})

Subtitle Sample:
"""
${sample}
"""

CRITICAL: Only reject if the text is:
1. In a completely different language than expected
2. Completely corrupted/unreadable (like random symbols: ���������)
3. Not actual language text (only symbols, numbers, or sound effects)

ACCEPT if the text is:
- In the correct language but has repetition, stuttering, or informal speech
- Natural dialogue with interruptions or incomplete sentences
- Auto-generated captions with minor imperfections
- Contains some sound effects [MUSIC] but has readable text in the correct language

Please respond in this exact JSON format:
{
  "detectedLanguage": "language_code",
  "detectedLanguageName": "Language Name", 
  "isExpectedLanguage": true/false,
  "confidence": 95,
  "isCriticallyCorrupted": false,
  "reasoning": "Brief explanation focusing on language detection"
}

Language codes: en=English, es=Spanish, fr=French, de=German, it=Italian, pt=Portuguese, ru=Russian, ja=Japanese, zh=Chinese, etc.`;
  }

  private parseValidationResponse(
    response: string,
    expectedLanguage: string
  ): SubtitleQualityResult {
    try {
      // Extract JSON from the response (in case there's extra text)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Much more lenient validation - only reject if language is wrong or critically corrupted
      const isValid =
        parsed.isExpectedLanguage &&
        parsed.confidence >= 60 &&
        !parsed.isCriticallyCorrupted;

      return {
        isValid,
        detectedLanguage: parsed.detectedLanguage || "unknown",
        confidence: parsed.confidence || 0,
        issues: parsed.isCriticallyCorrupted
          ? ["Critically corrupted text"]
          : [],
        reason: parsed.reasoning || "No specific reason provided",
      };
    } catch (error) {
      logSubtitleError("QualityValidation_ParseError", error, {
        response: response.substring(0, 500),
      });

      // Fallback parsing - try to extract basic info
      const lowerResponse = response.toLowerCase();

      // Simple language detection fallback
      let detectedLanguage = expectedLanguage;
      const languagePatterns = {
        en: /english|inglés/i,
        es: /spanish|español|castellano/i,
        fr: /french|français/i,
        de: /german|deutsch/i,
        it: /italian|italiano/i,
        pt: /portuguese|português/i,
        ru: /russian|русский/i,
        ja: /japanese|日本語/i,
        zh: /chinese|中文/i,
      };

      for (const [code, pattern] of Object.entries(languagePatterns)) {
        if (pattern.test(response)) {
          detectedLanguage = code;
          break;
        }
      }

      // Only reject if clearly wrong language or corrupted
      const isValid =
        detectedLanguage === expectedLanguage &&
        !lowerResponse.includes("different language") &&
        !lowerResponse.includes("wrong language") &&
        !lowerResponse.includes("corrupted") &&
        !lowerResponse.includes("unreadable");

      return {
        isValid,
        detectedLanguage,
        confidence: 70, // Higher confidence for fallback since we're being more lenient
        issues: isValid ? [] : ["Language mismatch or corruption detected"],
        reason: "Fallback validation focusing on language detection only",
      };
    }
  }
}

// Export singleton instance
export const subtitleQualityValidator = new SubtitleQualityValidator();
