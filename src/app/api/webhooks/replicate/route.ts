import { NextRequest, NextResponse } from "next/server";
import { supabaseServiceRoleClient } from "@/lib/supabase/serviceRoleClient";
import { AppError, AppErrorCode } from "@/app/actions/actions";

// Define expected Replicate webhook payload structure (adjust based on actual output)
interface ReplicateWebhookPayload {
  id: string; // Prediction ID
  version: string;
  status: "succeeded" | "failed" | "canceled";
  input: {
    file_url?: string;
    // ... other inputs
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  output?: any; // Transcription result (structure depends on the model)
  error?: string; // Error message if status is failed
  logs?: string;
  metrics?: {
    predict_time?: number;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  webhook_context?: any; // Context if provided during creation (we don't use it here)
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const transcriptionId = new URL(request.url).searchParams.get(
      "transcription_id"
    );

    if (!transcriptionId) {
      console.error("Missing transcription_id in webhook request");
      return new Response("Missing transcription_id", { status: 400 });
    }

    // Validate payload structure
    if (!payload || typeof payload !== "object") {
      console.error("Invalid payload structure:", payload);
      return new Response("Invalid payload structure", { status: 400 });
    }

    // Log the webhook payload for debugging
    console.log("Received Replicate webhook:", {
      transcriptionId,
      status: payload.status,
      output: payload.output ? "present" : "missing",
      error: payload.error,
    });

    // Update transcription record with Replicate's output
    const { error } = await supabaseServiceRoleClient
      .from("transcriptions")
      .update({
        status: payload.status === "succeeded" ? "completed" : "failed",
        content: payload.output,
        error_message: payload.status === "failed" ? payload.error : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", transcriptionId);

    if (error) {
      console.error("Error updating transcription:", error);
      throw new AppError(
        AppErrorCode.DATABASE_ERROR,
        `Failed to update transcription: ${error.message}`
      );
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(
      error instanceof AppError ? error.message : "Internal server error",
      { status: 500 }
    );
  }
}

// Handle GET requests (e.g., for verification or testing)
export async function GET() {
  console.log("Received GET request on /api/webhooks/replicate");
  // You might want to implement a challenge-response verification here
  // if Replicate requires webhook verification via GET.
  return NextResponse.json({ message: "Webhook endpoint active." });
}
