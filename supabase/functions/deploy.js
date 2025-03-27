/**
 * This script deploys all the Supabase Edge Functions
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Functions to deploy
const functions = [
  "process-youtube-url",
  "get-audio-chunk",
  "youtube-search",
  "update-history",
  "toggle-favorite",
];

// Base URL for Next.js API
const NEXTJS_API_URL = process.env.NEXTJS_API_URL || "http://localhost:3000";

console.log(`Deploying functions with NEXTJS_API_URL: ${NEXTJS_API_URL}`);

// First, set the secret
execSync(`supabase secrets set NEXTJS_API_URL=${NEXTJS_API_URL}`, {
  stdio: "inherit",
});

// Deploy each function
for (const funcName of functions) {
  const funcPath = path.join(__dirname, funcName);

  if (fs.existsSync(funcPath)) {
    console.log(`Deploying function: ${funcName}...`);
    try {
      execSync(`supabase functions deploy ${funcName}`, {
        stdio: "inherit",
      });
      console.log(`Successfully deployed ${funcName}`);
    } catch (error) {
      console.error(`Error deploying ${funcName}:`, error.message);
    }
  } else {
    console.log(`Function directory not found: ${funcPath}`);
  }
}

console.log("Deployment complete");
