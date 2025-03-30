import { NextResponse } from "next/server";
import { supabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/supabase";

// Define expected Replicate webhook payload structure (adjust based on actual output)
interface ReplicateWebhookPayload {
  id: string; // Prediction ID
  version: string;
  status: "succeeded" | "failed" | "canceled";
  input: {
    file_url?: string;
    // ... other inputs
  };
  output?: any; // Transcription result (structure depends on the model)
  error?: string; // Error message if status is failed
  logs?: string;
  metrics?: {
    predict_time?: number;
  };
  webhook_context?: any; // Context if provided during creation (we don't use it here)
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const transcriptionId = searchParams.get("transcription_id");

  if (!transcriptionId) {
    console.error(
      "Replicate webhook: Missing transcription_id query parameter."
    );
    return NextResponse.json(
      { error: "Missing transcription_id" },
      { status: 400 }
    );
  }

  let payload: ReplicateWebhookPayload;
  try {
    payload = await request.json();
    console.log(
      `Replicate webhook received for transcription ${transcriptionId}, prediction ${payload.id}, status: ${payload.status}`
    );
  } catch (error) {
    console.error("Replicate webhook: Error parsing JSON payload:", error);
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 }
    );
  }

  // Verify prediction ID matches if possible (optional but good practice)
  // Fetch transcription record to double-check prediction ID? Maybe not necessary if ID is in URL

  try {
    let updateData: Partial<
      Database["public"]["Tables"]["transcriptions"]["Update"]
    > = {};

    if (payload.status === "succeeded") {
      // TODO: Validate payload.output structure based on whisper-diarization model
      if (!payload.output) {
        console.error(
          `Replicate webhook: Prediction ${payload.id} succeeded but output is missing.`
        );
        updateData = {
          status: "failed",
          error_message: "Replicate succeeded but output was missing.",
          updated_at: new Date().toISOString(),
        };
      } else {
        console.log(
          `Replicate prediction ${payload.id} succeeded. Saving output.`
        );
        // Assuming payload.output is the JSON array of segments
        updateData = {
          status: "completed",
          content: payload.output, // Store the full output
          error_message: null,
          updated_at: new Date().toISOString(),
          // Optionally update replicate_prediction_id again for verification?
          replicate_prediction_id: payload.id,
        };
      }
    } else if (payload.status === "failed" || payload.status === "canceled") {
      console.error(
        `Replicate prediction ${payload.id} failed or canceled. Error: ${payload.error}`
      );
      updateData = {
        status: "failed",
        error_message: `Replicate prediction failed: ${
          payload.error || "Unknown error"
        }`,
        updated_at: new Date().toISOString(),
        replicate_prediction_id: payload.id, // Store the prediction ID even on failure
      };
    } else {
      // Ignore other statuses (e.g., 'starting', 'processing')
      console.log(
        `Replicate webhook: Ignoring status ${payload.status} for prediction ${payload.id}`
      );
      return NextResponse.json({ message: "Status ignored" }, { status: 200 });
    }

    // Update the transcription record in Supabase
    const { error: updateError } = await supabaseServerClient
      .from("transcriptions")
      .update(updateData)
      .eq("id", transcriptionId);

    if (updateError) {
      console.error(
        `Replicate webhook: Error updating transcription record ${transcriptionId}:`,
        updateError
      );
      // Don't necessarily return 500 to Replicate, as it might retry pointlessly
      // Log the error for investigation
      return NextResponse.json(
        { error: "Database update failed" },
        { status: 500 }
      ); // Or 200 if you don't want retries
    }

    console.log(
      `Successfully updated transcription record ${transcriptionId} with status ${updateData.status}.`
    );
    return NextResponse.json(
      { message: "Webhook received and processed" },
      { status: 200 }
    );
  } catch (error) {
    console.error(
      "Replicate webhook: Unexpected error processing webhook:",
      error
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Optional: Implement GET for simple verification if needed
export async function GET(request: Request) {
  return NextResponse.json({
    message: "Replicate webhook endpoint is active. Use POST.",
  });
}
