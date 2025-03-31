import { type NextRequest, NextResponse } from "next/server";
import { supabaseServiceRoleClient } from "@/lib/supabase/serviceRoleClient";
import type { TranscriptionSegment } from "@/app/actions/video"; // Reuse existing type

// Define the expected Replicate webhook payload structure
interface ReplicateWebhookPayload {
  id: string; // Prediction ID
  version: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  input: Record<string, any>; // Can be more specific if needed
  output?: {
    // Only present on 'succeeded'
    detected_language?: string;
    segments?: TranscriptionSegment[];
    // Add other fields from Replicate output if needed
  } | null;
  error?: string | null; // Only present on 'failed'
  logs?: string;
  metrics?: Record<string, any>;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  urls: {
    get: string;
    cancel: string;
  };
}

export async function POST(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const transcriptionId = searchParams.get("transcription_id");
  const replicateSecret = process.env.REPLICATE_WEBHOOK_SECRET; // Optional: For security

  // Optional: Basic Secret Validation (adjust as needed)
  // const providedSecret = request.headers.get('X-Replicate-Secret'); // Or another header if Replicate supports custom headers
  // if (replicateSecret && providedSecret !== replicateSecret) {
  //   console.warn("Replicate webhook: Invalid secret received.");
  //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // }

  if (!transcriptionId) {
    console.error(
      "Replicate webhook: Missing 'transcription_id' query parameter."
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
      `Received Replicate webhook for transcription ${transcriptionId}: Status - ${payload.status}`
    );
  } catch (error) {
    console.error("Replicate webhook: Failed to parse request body:", error);
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  const { status, output, error: replicateError, id: predictionId } = payload;

  try {
    const supabase = supabaseServiceRoleClient;

    // Fetch the existing transcription record to ensure it exists and potentially check current status
    const { data: existingTranscription, error: fetchError } = await supabase
      .from("transcriptions")
      .select("id, status, replicate_prediction_id")
      .eq("id", transcriptionId)
      .maybeSingle();

    if (fetchError) {
      console.error(
        `Replicate webhook: Error fetching transcription ${transcriptionId}:`,
        fetchError
      );
      return NextResponse.json(
        { error: "Database error fetching record" },
        { status: 500 }
      );
    }

    if (!existingTranscription) {
      console.warn(
        `Replicate webhook: Transcription record ${transcriptionId} not found.`
      );
      // Return 200 OK to Replicate even if we don't find the record,
      // as retrying won't help if it's truly missing.
      return NextResponse.json(
        { message: "Transcription record not found" },
        { status: 200 }
      );
    }

    // Idempotency check: If already completed or failed, don't process again
    if (
      existingTranscription.status === "completed" ||
      existingTranscription.status === "failed"
    ) {
      console.log(
        `Replicate webhook: Transcription ${transcriptionId} already processed (status: ${existingTranscription.status}). Ignoring webhook.`
      );
      return NextResponse.json(
        { message: "Already processed" },
        { status: 200 }
      );
    }

    // Check if the prediction ID matches (optional security measure)
    if (
      existingTranscription.replicate_prediction_id &&
      existingTranscription.replicate_prediction_id !== predictionId
    ) {
      console.warn(
        `Replicate webhook: Prediction ID mismatch for transcription ${transcriptionId}. Expected ${existingTranscription.replicate_prediction_id}, got ${predictionId}.`
      );
      // Decide how to handle: ignore, error, etc. For now, log and proceed cautiously.
    }

    if (status === "succeeded") {
      if (!output || !output.segments) {
        console.error(
          `Replicate webhook: 'succeeded' status but missing output.segments for transcription ${transcriptionId}. Payload:`,
          output
        );
        // Update status to failed because output is unusable
        const { error: updateError } = await supabase
          .from("transcriptions")
          .update({
            status: "failed",
            error_message: "Replicate succeeded but output format was invalid.",
            completed_at: new Date().toISOString(),
          })
          .eq("id", transcriptionId);

        if (updateError) {
          console.error(
            `Replicate webhook: Failed to update transcription ${transcriptionId} status to 'failed' after invalid output:`,
            updateError
          );
        }
        return NextResponse.json(
          { error: "Invalid output format" },
          { status: 400 }
        ); // Or 500 if DB update failed
      }

      // Format content if needed, here we assume output.segments is directly usable
      const transcriptionContent = output.segments;

      // Cast to unknown and then any to satisfy Supabase client type for jsonb
      const transcriptionContentAny = transcriptionContent as unknown as any;

      console.log(
        `Replicate webhook: Updating transcription ${transcriptionId} to 'completed'.`
      );
      const { error: updateError } = await supabase
        .from("transcriptions")
        .update({
          status: "completed",
          content: transcriptionContentAny, // Use the casted value
          error_message: null, // Clear any previous error
          completed_at: new Date().toISOString(),
        })
        .eq("id", transcriptionId);

      if (updateError) {
        console.error(
          `Replicate webhook: Failed to update transcription ${transcriptionId} to 'completed':`,
          updateError
        );
        return NextResponse.json(
          { error: "Database update error" },
          { status: 500 }
        );
      }

      console.log(
        `Replicate webhook: Successfully processed 'succeeded' status for transcription ${transcriptionId}.`
      );
      return NextResponse.json(
        { message: "Webhook processed successfully" },
        { status: 200 }
      );
    } else if (status === "failed") {
      console.error(
        `Replicate webhook: Transcription ${transcriptionId} failed. Error: ${replicateError}`
      );
      const { error: updateError } = await supabase
        .from("transcriptions")
        .update({
          status: "failed",
          error_message:
            replicateError ||
            "Replicate prediction failed without specific error message.",
          completed_at: new Date().toISOString(), // Mark completion time even for failure
        })
        .eq("id", transcriptionId);

      if (updateError) {
        console.error(
          `Replicate webhook: Failed to update transcription ${transcriptionId} status to 'failed':`,
          updateError
        );
        return NextResponse.json(
          { error: "Database update error" },
          { status: 500 }
        );
      }

      console.log(
        `Replicate webhook: Successfully processed 'failed' status for transcription ${transcriptionId}.`
      );
      return NextResponse.json(
        { message: "Webhook processed successfully (failure)" },
        { status: 200 }
      );
    } else if (status === "processing" || status === "starting") {
      // Optional: Update status if we want to track these intermediate states
      console.log(
        `Replicate webhook: Received intermediate status '${status}' for transcription ${transcriptionId}. No DB update needed.`
      );
      return NextResponse.json(
        { message: "Intermediate status received" },
        { status: 200 }
      );
    } else if (status === "canceled") {
      console.log(
        `Replicate webhook: Received 'canceled' status for transcription ${transcriptionId}. Treating as failed.`
      );
      const { error: updateError } = await supabase
        .from("transcriptions")
        .update({
          status: "failed",
          error_message: "Replicate prediction was canceled.",
          completed_at: new Date().toISOString(),
        })
        .eq("id", transcriptionId);
      if (updateError) {
        console.error(
          `Replicate webhook: Failed to update transcription ${transcriptionId} status to 'failed' after cancel:`,
          updateError
        );
        return NextResponse.json(
          { error: "Database update error" },
          { status: 500 }
        );
      }
      return NextResponse.json(
        { message: "Webhook processed successfully (canceled)" },
        { status: 200 }
      );
    } else {
      console.warn(
        `Replicate webhook: Received unknown status '${status}' for transcription ${transcriptionId}.`
      );
      return NextResponse.json({ message: "Unknown status" }, { status: 200 }); // Acknowledge receipt
    }
  } catch (error: any) {
    console.error(
      `Replicate webhook: Unexpected error processing webhook for ${transcriptionId}:`,
      error
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Optional: Add GET handler for verification if Replicate requires it
// export async function GET(request: NextRequest) {
//   return NextResponse.json({ message: "Webhook endpoint active" });
// }
