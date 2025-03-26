import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.23.0";

// Environment variables from Supabase
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const nextjsApiUrl =
  Deno.env.get("NEXTJS_API_URL") || "https://youtubedubbing.vercel.app";

serve(async (req) => {
  try {
    // Create supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get request body
    const { url, language, voice } = await req.json();

    if (!url || !language || !voice) {
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "INVALID_REQUEST",
            message: "URL, language, and voice parameters are required",
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

    // Forward request to the Next.js API
    const response = await fetch(`${nextjsApiUrl}/api/youtube/process`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({ url, language, voice }),
    });

    const data = await response.json();

    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in process-youtube-url function:", error);

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
