import OpenAI from "openai";
import { AppError, AppErrorCode } from "@/app/actions/actions";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface TranslationOptions {
  sourceLanguage?: string;
  targetLanguage: string;
  preserveFormatting?: boolean;
}

export async function translateText(
  text: string,
  options: TranslationOptions
): Promise<string> {
  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new AppError(
        AppErrorCode.OPENAI_API_ERROR,
        "OpenAI API key not configured."
      );
    }

    const {
      sourceLanguage,
      targetLanguage,
      preserveFormatting = true,
    } = options;

    // Construct the prompt for translation
    const prompt = `Translate the following text to ${targetLanguage}${
      sourceLanguage ? ` from ${sourceLanguage}` : ""
    }. ${
      preserveFormatting
        ? "Preserve any formatting, punctuation, and special characters."
        : ""
    }\n\nText to translate:\n${text}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content:
            "You are a professional translator. Provide only the translated text without any explanations or additional context.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.3, // Lower temperature for more consistent translations
    });

    const translatedText = completion.choices[0]?.message?.content?.trim();
    if (!translatedText) {
      throw new AppError(
        AppErrorCode.OPENAI_API_ERROR,
        "Translation failed: No response from OpenAI"
      );
    }

    return translatedText;
  } catch (error) {
    console.error("Translation error:", error);
    throw error instanceof AppError
      ? error
      : new AppError(AppErrorCode.OPENAI_API_ERROR, "Failed to translate text");
  }
}
