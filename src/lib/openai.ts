import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY_NEW;

if (!apiKey) {
  // In development, you might allow this, but log a warning.
  // In production, this should likely be an error.
  console.warn(
    "Missing env.OPENAI_API_KEY_NEW. OpenAI functionality will be disabled."
  );
  // throw new Error("Missing env.OPENAI_API_KEY_NEW");
}

// Initialize OpenAI client (handles apiKey being potentially undefined)
export const openai = new OpenAI({
  apiKey: apiKey,
});

// Helper function for basic translation using Chat Completion
export async function translateTextOpenAI(
  text: string,
  sourceLang: string, // e.g., "English"
  targetLang: string // e.g., "Spanish"
): Promise<string | null> {
  if (!apiKey) {
    console.error("OpenAI API key not configured, cannot translate.");
    return null; // Or throw an error?
  }
  if (!text?.trim()) {
    return ""; // Return empty if input is empty
  }
  if (sourceLang.toLowerCase() === targetLang.toLowerCase()) {
    return text; // No translation needed
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", // Or choose another model like gpt-4
      messages: [
        {
          role: "system",
          content: `You are a helpful translation assistant. Translate the following text from ${sourceLang} to ${targetLang}. Output ONLY the translated text, without any introductory phrases or explanations.`,
        },
        {
          role: "user",
          content: text,
        },
      ],
      temperature: 0.3, // Lower temperature for more deterministic translation
      max_tokens: 1000, // Adjust based on expected text length
    });

    const translatedText = completion.choices[0]?.message?.content?.trim();

    if (!translatedText) {
      console.error("OpenAI translation returned empty content.");
      return null;
    }

    return translatedText;
  } catch (error) {
    console.error("Error during OpenAI translation:", error);
    return null; // Return null on error
  }
}
