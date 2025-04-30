import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";

// Import all Inngest functions
import {
  handleTranslationRequest,
  handleTtsSpawnInitial,
  handleTtsGenerateChunk,
} from "@/inngest/functions"; // Adjust path as needed

// Create an API that serves all the functions together
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    handleTranslationRequest,
    handleTtsSpawnInitial,
    handleTtsGenerateChunk,
    // Add any other functions here
  ],
});
