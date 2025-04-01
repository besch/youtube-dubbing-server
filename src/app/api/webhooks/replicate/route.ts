import { type NextRequest, NextResponse } from "next/server";
import { supabaseServiceRoleClient } from "@/lib/supabase/serviceRoleClient";
import { AppError, AppErrorCode } from "@/app/actions/actions"; // Import error types if needed

// Define the expected Replicate webhook payload structure
interface TranscriptionWord {
  start?: number; // Mark as optional as they might be missing
  end?: number;
  word?: string;
}
interface ReplicateSegment {
  start?: number;
  end?: number;
  text?: string;
  words?: TranscriptionWord[];
}
interface ReplicateOutput {
  segments?: ReplicateSegment[];
  // Include other potential top-level fields like detected_language
}
interface ReplicateWebhookPayload {
  id: string; // Prediction ID
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: ReplicateOutput | null; // The transcription result on success
  error?: any; // Error details on failure
  // Include other fields Replicate sends if needed
}

// --- Security Function (Placeholder) ---
// You MUST implement proper webhook signature verification in production
// See Replicate documentation and libraries like `svix`
function isValidWebhookSignature(request: Request, body: string): boolean {
  // const secret = process.env.REPLICATE_WEBHOOK_SECRET;
  // const signature = request.headers.get('Webhook-Signature'); // Adjust header name if needed
  // if (!secret || !signature) return false;
  // try {
  //     const wh = new Webhook(secret);
  //     wh.verify(body, { signature }); // Throws error on invalid signature
  //     return true;
  // } catch (err) {
  //     console.error('Webhook signature verification failed:', err);
  //     return false;
  // }
  console.warn(
    "Webhook signature verification is skipped! Implement for production."
  );
  return true; // !! REMOVE THIS IN PRODUCTION !!
}

export async function POST(request: Request) {
  const supabase = supabaseServiceRoleClient;
  let prediction: ReplicateWebhookPayload | null = null;
  let requestBodyText: string;

  try {
    requestBodyText = await request.text(); // Read body once for verification and parsing

    // --- 1. Verify Webhook Signature (CRITICAL FOR PRODUCTION) ---
    if (!isValidWebhookSignature(request, requestBodyText)) {
      console.warn("Invalid webhook signature received.");
      return new NextResponse("Invalid signature", { status: 401 });
    }

    // --- 2. Parse Payload ---
    try {
      prediction = JSON.parse(requestBodyText) as ReplicateWebhookPayload;
    } catch (e) {
      console.error("Webhook error: Failed to parse JSON body:", e);
      return new NextResponse("Invalid JSON body", { status: 400 });
    }

    // --- 3. Validate Payload and Status ---
    if (!prediction || !prediction.id) {
      console.warn(
        "Webhook received invalid or missing prediction ID.",
        prediction
      );
      return new NextResponse("Invalid payload", { status: 400 });
    }

    console.log(
      `Webhook received for Replicate ID: ${prediction.id}, Status: ${prediction.status}`
    );

    if (prediction.status !== "succeeded") {
      if (prediction.status === "failed") {
        console.error(
          `Replicate prediction ${prediction.id} failed:`,
          prediction.error
        );
        // Optionally update the DB record to 'failed'
        try {
          // TODO: Regenerate Supabase types
          await supabase
            .from("transcription_segments" as any)
            .update({
              status: "failed",
              error_message: JSON.stringify(
                prediction.error ?? "Replicate reported failure"
              ),
              completed_at: new Date().toISOString(),
            })
            .eq("replicate_prediction_id", prediction.id);
        } catch (dbError) {
          console.error(
            `Webhook: Error updating segment status to failed for ${prediction.id}:`,
            dbError
          );
        }
      }
      // Acknowledge other non-success statuses (processing, canceled) without error
      return NextResponse.json(
        { message: "Webhook acknowledged (status not 'succeeded')" },
        { status: 200 }
      );
    }

    // --- 4. Process Successful Prediction ---
    if (!prediction.output) {
      console.error(
        `Webhook error: Prediction ${prediction.id} succeeded but output is missing.`
      );
      // Update DB to failed status as output is unusable
      await supabase
        .from("transcription_segments" as any)
        .update({
          status: "failed",
          error_message: "Replicate succeeded but output was empty.",
          completed_at: new Date().toISOString(),
        })
        .eq("replicate_prediction_id", prediction.id);
      return new NextResponse("Missing prediction output", { status: 400 });
    }

    // --- 5. Find Corresponding Segment in DB ---
    const { data: segmentData, error: findError } = await supabase
      .from("transcription_segments" as any)
      .select("id, start_time")
      .eq("replicate_prediction_id", prediction.id)
      .maybeSingle();

    if (findError) {
      console.error(
        `Webhook DB error: Failed finding segment for Replicate ID ${prediction.id}:`,
        findError
      );
      // Don't return 500, as Replicate might retry endlessly. Log the error.
      return NextResponse.json(
        { message: "Webhook acknowledged (database error finding segment)" },
        { status: 200 }
      );
    }

    // Use cast and optional chaining here
    const segmentId = (segmentData as any)?.id;
    const segmentStartTime = (segmentData as any)?.start_time ?? 0;

    if (!segmentId) {
      console.error(
        `Webhook error: No transcription segment found for Replicate ID ${prediction.id}`
      );
      return NextResponse.json(
        { message: "Webhook acknowledged (segment not found)" },
        { status: 200 }
      );
    }

    // --- 6. Timestamp Adjustment --- //
    let adjustedOutput = prediction.output;

    if (
      segmentStartTime > 0 &&
      adjustedOutput?.segments &&
      Array.isArray(adjustedOutput.segments)
    ) {
      console.log(
        `Adjusting timestamps in transcription for segment ${segmentId} by +${segmentStartTime} seconds.`
      );
      adjustedOutput.segments.forEach((s: ReplicateSegment) => {
        if (s.words && Array.isArray(s.words)) {
          s.words.forEach((w: TranscriptionWord) => {
            // Add start_time only if the timestamp exists and is a number
            if (typeof w.start === "number") w.start += segmentStartTime;
            if (typeof w.end === "number") w.end += segmentStartTime;
          });
        }
        // Adjust segment-level timestamps if they exist
        if (typeof s.start === "number") s.start += segmentStartTime;
        if (typeof s.end === "number") s.end += segmentStartTime;
      });
    } else if (segmentStartTime > 0) {
      console.warn(
        `Webhook for ${prediction.id}: Cannot adjust timestamps, output format unexpected or start_time is 0. Output:`,
        adjustedOutput
      );
    }

    // --- 7. Update Segment Record in DB ---
    const { error: updateError } = await supabase
      .from("transcription_segments" as any)
      .update({
        status: "completed",
        content: adjustedOutput, // Store the adjusted transcription
        completed_at: new Date().toISOString(),
        error_message: null, // Clear previous errors if any
      })
      .eq("id", segmentId);

    if (updateError) {
      console.error(
        `Webhook DB error: Failed updating segment ${segmentId} for Replicate ID ${prediction.id}:`,
        updateError
      );
      // Don't return 500
      return NextResponse.json(
        { message: "Webhook acknowledged (database error updating segment)" },
        { status: 200 }
      );
    }

    console.log(
      `Successfully processed webhook for segment ${segmentId} (Replicate ID: ${prediction.id})`
    );
    return NextResponse.json(
      { message: "Webhook processed successfully" },
      { status: 200 }
    );
  } catch (error: any) {
    console.error(`Webhook - Unexpected error processing webhook:`, error);
    // Log details if possible
    if (prediction?.id) {
      console.error(`Webhook - Failed prediction ID: ${prediction.id}`);
    }
    // Avoid returning 5xx to prevent Replicate retries for unexpected server issues
    return NextResponse.json(
      { message: "Webhook acknowledged (internal server error)" },
      { status: 200 }
    );
  }
}

// Optional: Add GET handler for verification if Replicate requires it
// export async function GET(request: NextRequest) {
//   return NextResponse.json({ message: "Webhook endpoint active" });
// }
