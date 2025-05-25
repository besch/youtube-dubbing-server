import { SubtitleQualityValidator } from "./quality-validator";

// Mock test data
const englishSrtSample = `1
00:00:01,000 --> 00:00:03,000
Hello, how are you today?

2
00:00:04,000 --> 00:00:06,000
I'm doing well, thank you for asking.

3
00:00:07,000 --> 00:00:09,000
That's great to hear!`;

const spanishSrtSample = `1
00:00:01,000 --> 00:00:03,000
Hola, ¿cómo estás hoy?

2
00:00:04,000 --> 00:00:06,000
Estoy bien, gracias por preguntar.

3
00:00:07,000 --> 00:00:09,000
¡Eso es genial escuchar!`;

const corruptedSrtSample = `1
00:00:01,000 --> 00:00:03,000
���������������

2
00:00:04,000 --> 00:00:06,000
@#$%^&*()_+{}|:"<>?

3
00:00:07,000 --> 00:00:09,000
♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪`;

const repetitiveSrtSample = `1
00:00:01,000 --> 00:00:03,000
I had to... I had to... I had to...

2
00:00:04,000 --> 00:00:06,000
She... she... she's all for you, Morty.

3
00:00:07,000 --> 00:00:09,000
[BURPS] What do you think of this flying vehicle?`;

async function testQualityValidator() {
  console.log("Testing Subtitle Quality Validator...");

  if (!process.env.GOOGLE_API_KEY) {
    console.log("GOOGLE_API_KEY not set, skipping tests");
    return;
  }

  try {
    const validator = new SubtitleQualityValidator();

    // Test 1: English content with English expectation (should pass)
    console.log("\n--- Test 1: English content, expecting English ---");
    const result1 = await validator.validateSubtitleQuality({
      content: englishSrtSample,
      expectedLanguage: "en",
    });
    console.log("Result:", result1);

    // Test 2: Spanish content with English expectation (should fail)
    console.log("\n--- Test 2: Spanish content, expecting English ---");
    const result2 = await validator.validateSubtitleQuality({
      content: spanishSrtSample,
      expectedLanguage: "en",
    });
    console.log("Result:", result2);

    // Test 3: Spanish content with Spanish expectation (should pass)
    console.log("\n--- Test 3: Spanish content, expecting Spanish ---");
    const result3 = await validator.validateSubtitleQuality({
      content: spanishSrtSample,
      expectedLanguage: "es",
    });
    console.log("Result:", result3);

    // Test 4: Corrupted content (should fail)
    console.log("\n--- Test 4: Corrupted content, expecting English ---");
    const result4 = await validator.validateSubtitleQuality({
      content: corruptedSrtSample,
      expectedLanguage: "en",
    });
    console.log("Result:", result4);

    // Test 5: Repetitive but valid English content (should pass now)
    console.log(
      "\n--- Test 5: Repetitive English content, expecting English ---"
    );
    const result5 = await validator.validateSubtitleQuality({
      content: repetitiveSrtSample,
      expectedLanguage: "en",
    });
    console.log("Result:", result5);
  } catch (error) {
    console.error("Test failed:", error);
  }
}

// Export for potential use in other test files
export { testQualityValidator };

// Run tests if this file is executed directly
if (require.main === module) {
  testQualityValidator();
}
