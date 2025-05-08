import { type NextRequest, NextResponse } from "next/server";
import { supabaseServiceRoleClient } from "@/lib/supabase/serviceRoleClient";
import type { Tables } from "@/types/supabase";

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
  console.log("Webhook: Entered isValidWebhookSignature"); // Added Log
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
    "Webhook: Signature verification is SKIPPED! Implement for production."
  );
  return true; // !! REMOVE THIS IN PRODUCTION !!
}

export async function POST(request: Request) {
  console.log("Webhook: Received POST request."); // Added Log
  const supabase = supabaseServiceRoleClient;
  let prediction: ReplicateWebhookPayload | null = null;
  let requestBodyText: string;

  try {
    requestBodyText = await request.text(); // Read body once for verification and parsing
    console.log("Webhook: Read request body."); // Added Log

    // --- 1. Verify Webhook Signature (CRITICAL FOR PRODUCTION) ---
    if (!isValidWebhookSignature(request, requestBodyText)) {
      console.warn("Webhook: Invalid signature received. Rejecting."); // Added Log
      return new NextResponse("Invalid signature", { status: 401 });
    }
    console.log("Webhook: Signature verification passed (or skipped)."); // Added Log

    // --- 2. Parse Payload ---
    try {
      prediction = JSON.parse(requestBodyText) as ReplicateWebhookPayload;
      console.log("Webhook: Parsed JSON payload."); // Added Log
    } catch (e) {
      console.error("Webhook error: Failed to parse JSON body:", e);
      return new NextResponse("Invalid JSON body", { status: 400 });
    }

    // --- 3. Validate Payload and Status ---
    if (!prediction || !prediction.id) {
      console.warn(
        "Webhook: Invalid payload or missing prediction ID. Body:", // Added Log context
        requestBodyText
      );
      return new NextResponse("Invalid payload", { status: 400 });
    }

    console.log(
      // Enhanced Log
      `Webhook: Processing Replicate ID: ${prediction.id}, Status: ${prediction.status}`
    );

    if (prediction.status !== "succeeded") {
      if (prediction.status === "failed") {
        console.error(
          // Enhanced Log
          `Webhook: Replicate prediction ${prediction.id} failed:`,
          JSON.stringify(prediction.error, null, 2) // Stringify error for better logging
        );
        // Optionally update the DB record to 'failed'
        try {
          console.log(
            `Webhook: Updating segment status to 'failed' for Replicate ID ${prediction.id}`
          ); // Added Log
          // Use generated types
          const { error: updateFailError } = await supabase // Added variable for error logging
            .from("transcription_segments") // Use string literal
            .update({
              status: "failed",
              error_message: JSON.stringify(
                prediction.error ?? "Replicate reported failure"
              ),
              completed_at: new Date().toISOString(),
            })
            .eq("replicate_prediction_id", prediction.id);
          if (updateFailError) {
            // Log if update fails
            console.error(
              `Webhook: DB error updating segment status to failed for ${prediction.id}:`,
              updateFailError
            );
          } else {
            console.log(
              `Webhook: Successfully updated segment status to 'failed' for Replicate ID ${prediction.id}`
            ); // Added Log
          }
        } catch (dbError) {
          console.error(
            // Keep original catch but added context
            `Webhook: Catch block error updating segment status to failed for ${prediction.id}:`,
            dbError
          );
        }
      } else {
        // Log other statuses
        console.log(
          `Webhook: Received status "${prediction.status}" for ${prediction.id}. Acknowledging.`
        );
      }
      // Acknowledge other non-success statuses (processing, canceled) without error
      return NextResponse.json(
        { message: `Webhook acknowledged (status ${prediction.status})` }, // More specific message
        { status: 200 }
      );
    }

    // --- 4. Process Successful Prediction ---
    if (!prediction.output) {
      console.error(
        // Enhanced Log
        `Webhook error: Prediction ${prediction.id} succeeded but output is MISSING.`
      );
      // Update DB to failed status as output is unusable
      try {
        // Wrap DB call in try-catch
        console.log(
          `Webhook: Updating segment status to 'failed' due to missing output for Replicate ID ${prediction.id}`
        ); // Added Log
        await supabase
          .from("transcription_segments") // Use string literal
          .update({
            status: "failed",
            error_message: "Replicate succeeded but output was empty.",
            completed_at: new Date().toISOString(),
          })
          .eq("replicate_prediction_id", prediction.id);
        console.log(
          `Webhook: Successfully updated segment status to 'failed' (missing output) for Replicate ID ${prediction.id}`
        ); // Added Log
      } catch (dbError) {
        console.error(
          `Webhook: DB error updating segment to failed (missing output) for ${prediction.id}:`,
          dbError
        );
      }
      return new NextResponse("Missing prediction output", { status: 400 });
    }
    console.log(`Webhook: Prediction ${prediction.id} succeeded with output.`); // Added Log

    // --- 5. Find Corresponding Segment in DB ---
    console.log(
      `Webhook: Searching for segment with Replicate ID: ${prediction.id}`
    ); // Added Log
    const { data: segmentData, error: findError } = await supabase
      .from("transcription_segments") // Use string literal
      .select("id, start_time")
      .eq("replicate_prediction_id", prediction.id)
      .maybeSingle();

    if (findError) {
      console.error(
        // Enhanced Log
        `Webhook DB Error: Failed finding segment for Replicate ID ${prediction.id}:`,
        findError
      );
      // Don't return 500, as Replicate might retry endlessly. Log the error.
      return NextResponse.json(
        { message: "Webhook acknowledged (database error finding segment)" },
        { status: 200 }
      );
    }

    // Use type assertion with generated type
    const segmentRecord =
      segmentData as Tables<"transcription_segments"> | null;

    if (!segmentRecord) {
      // Check segmentRecord directly
      console.error(
        // Enhanced Log
        `Webhook Error: No transcription segment found in DB for Replicate ID ${prediction.id}`
      );
      return NextResponse.json(
        { message: "Webhook acknowledged (segment not found in DB)" }, // More specific message
        { status: 200 }
      );
    }

    const segmentId = segmentRecord.id;
    const segmentStartTime = segmentRecord.start_time ?? 0; // Use nullish coalescing

    console.log(
      `Webhook: Found segment ID: ${segmentId} with start_time: ${segmentStartTime} for Replicate ID ${prediction.id}`
    ); // Added Log

    // --- 6. Timestamp Adjustment --- //
    const adjustedOutput = prediction.output; // Keep a reference

    // Basic validation of output structure before adjusting
    const hasSegments =
      adjustedOutput?.segments && Array.isArray(adjustedOutput.segments);

    if (segmentStartTime > 0 && hasSegments) {
      console.log(
        // Enhanced Log
        `Webhook: Adjusting timestamps in transcription for segment ${segmentId} by +${segmentStartTime} seconds.`
      );
      try {
        // Wrap adjustment logic in try-catch
        if (adjustedOutput.segments) {
          adjustedOutput.segments.forEach((s: ReplicateSegment) => {
            if (!s) return; // Skip null/undefined segments array elements

            // Adjust segment-level timestamps first
            if (typeof s.start === "number") s.start += segmentStartTime;
            if (typeof s.end === "number") s.end += segmentStartTime;

            // Adjust word-level timestamps
            if (s.words && Array.isArray(s.words)) {
              s.words.forEach((w: TranscriptionWord) => {
                // Add type hint
                if (!w) return; // Skip null/undefined words array elements
                // Add start_time only if the timestamp exists and is a number
                if (typeof w.start === "number") w.start += segmentStartTime;
                if (typeof w.end === "number") w.end += segmentStartTime;
              });
            } else {
              console.log(
                `Webhook: Segment text "${s.text?.substring(
                  0,
                  20
                )}..." has no words array or it's not an array.`
              ); // Log if words missing
            }
          });
          console.log(
            `Webhook: Timestamp adjustment completed for segment ${segmentId}.`
          ); // Added Log
        }
      } catch (adjustmentError) {
        console.error(
          `Webhook: Error during timestamp adjustment for segment ${segmentId}:`,
          adjustmentError
        );
        // Potentially update DB to failed state here if adjustment is critical
        // For now, just log and proceed with potentially unadjusted data
      }
    } else if (segmentStartTime > 0 && !hasSegments) {
      // Log if segments missing but adjustment needed
      console.warn(
        `Webhook: Cannot adjust timestamps for ${prediction.id} (segment ${segmentId}), 'segments' array missing or not an array in output. Output received:`,
        JSON.stringify(adjustedOutput) // Log the actual output
      );
    } else {
      // Log if no adjustment needed
      console.log(
        `Webhook: No timestamp adjustment needed for segment ${segmentId} (start_time is 0).`
      );
    }

    // --- 7. Update Segment Record in DB ---
    console.log(
      `Webhook: Updating DB record for segment ${segmentId} with adjusted content and status 'completed'.`
    ); // Added Log
    const { error: updateError } = await supabase
      .from("transcription_segments") // Use string literal
      .update({
        status: "completed",
        content: adjustedOutput as any, // Cast adjustedOutput to Json (or refine validation)
        completed_at: new Date().toISOString(),
        error_message: null, // Clear previous errors if any
      })
      .eq("id", segmentId);

    if (updateError) {
      console.error(
        // Enhanced Log
        `Webhook DB Error: Failed updating segment ${segmentId} (Replicate ID ${prediction.id}):`,
        updateError
      );
      // Don't return 500
      return NextResponse.json(
        { message: "Webhook acknowledged (database error updating segment)" },
        { status: 200 }
      );
    }

    console.log(
      // Enhanced Log
      `Webhook: Successfully processed and updated DB for segment ${segmentId} (Replicate ID: ${prediction.id})`
    );
    return NextResponse.json(
      { message: "Webhook processed successfully" },
      { status: 200 }
    );
  } catch (error: any) {
    console.error(`Webhook: Unexpected error in POST handler:`, error); // Enhanced Log
    // Log details if possible
    if (prediction?.id) {
      console.error(
        `Webhook: Failed prediction ID during unexpected error: ${prediction.id}`
      ); // Added Log
    }
    // Avoid returning 5xx to prevent Replicate retries for unexpected server issues
    return NextResponse.json(
      { message: "Webhook acknowledged (internal server error)" },
      { status: 200 } // Acknowledge receipt even on unexpected error
    );
  }
}

// Optional: Add GET handler for verification if Replicate requires it
export async function GET(request: NextRequest) {
  // Keep GET handler
  console.log("Webhook: Received GET request."); // Added Log
  return NextResponse.json({ message: "Replicate Webhook endpoint active" });
}
