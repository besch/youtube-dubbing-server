import { Inngest } from "inngest";

// Ensure environment variables are defined or throw an error
if (!process.env.INNGEST_EVENT_KEY) {
  throw new Error("INNGEST_EVENT_KEY environment variable is not set.");
}

// Create a client to send and receive events
export const inngest = new Inngest({
  id: "youtube-dubbing-server",
  // Optional: Set eventKey for secure event sending from non-trusted environments
  // This is generally recommended for production setups
  eventKey: process.env.INNGEST_EVENT_KEY,
});
