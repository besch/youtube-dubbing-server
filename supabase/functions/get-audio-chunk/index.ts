import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.23.0";

// Environment variables from Supabase
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const nextjsApiUrl =
  Deno.env.get("NEXTJS_API_URL") || "https://youtubedubbing.vercel.app";

console.log("Function loaded, nextjsApiUrl:", nextjsApiUrl);

serve(async (req) => {
  try {
    console.log("Request received");

    // Create supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get request body
    let requestBody;
    try {
      requestBody = await req.json();
      console.log("Request body:", JSON.stringify(requestBody));
    } catch (e) {
      console.error("Error parsing request body:", e);
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "INVALID_JSON",
            message: "Invalid JSON in request body",
          },
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const { videoId, dbVideoId, startTime, endTime, language, voice } =
      requestBody;

    if (
      !videoId ||
      !dbVideoId ||
      startTime === undefined ||
      endTime === undefined ||
      !language ||
      !voice
    ) {
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "INVALID_REQUEST",
            message: "Missing required parameters",
          },
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Get auth token if available, but don't require it
    const authHeader = req.headers.get("Authorization");
    const token = authHeader ? authHeader.replace("Bearer ", "") : null;

    console.log(
      `Forwarding request to: ${nextjsApiUrl}/api/youtube/audio-chunk`
    );

    // Forward request to the Next.js API
    try {
      const response = await fetch(`${nextjsApiUrl}/api/youtube/audio-chunk`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({
          videoId,
          dbVideoId,
          startTime,
          endTime,
          language,
          voice,
        }),
      });

      console.log("Next.js API response status:", response.status);

      // If the API call fails, return a fallback response
      if (response.status !== 200) {
        console.log("API call failed, returning fallback response");

        // Use local MP3 file from the Next.js server as fallback
        const fallbackUrl = `${nextjsApiUrl}/audio/mixkit-tech-house-vibes-130.mp3`;

        return new Response(
          JSON.stringify({
            success: true,
            data: {
              url: fallbackUrl,
              startTime: startTime,
              endTime: endTime,
              isFallback: true,
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const data = await response.json();
      console.log("Next.js API response data:", JSON.stringify(data));

      return new Response(JSON.stringify(data), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    } catch (fetchError) {
      console.error("Error fetching from Next.js API:", fetchError);

      // Return a fallback response if the API call fails
      // Use local MP3 file from the Next.js server as fallback
      const fallbackUrl = `${nextjsApiUrl}/audio/mixkit-tech-house-vibes-130.mp3`;

      return new Response(
        JSON.stringify({
          success: true,
          data: {
            url: fallbackUrl,
            startTime: startTime,
            endTime: endTime,
            isFallback: true,
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  } catch (error) {
    console.error("Error in get-audio-chunk function:", error);

    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: "UNEXPECTED_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "An unexpected error occurred",
        },
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
