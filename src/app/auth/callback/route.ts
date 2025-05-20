import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { Database } from "@/types/supabase";

async function sendMessageToExtension(
  extensionId: string,
  data: {
    type: string;
    token: string;
    subscriptionStatus: string;
    dailyVideoCount: number;
  }
) {
  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(
        `chrome-extension://${extensionId}/background.html`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(data),
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      if (result.success) {
        return true;
      }
      throw new Error(result.error || "Unknown error");
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  console.error(
    "Failed to send message to extension after retries:",
    lastError
  );
  return false;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");

  if (code) {
    const cookieStore = cookies();
    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
          set(name: string, value: string, options: any) {
            cookieStore.set({ name, value, ...options });
          },
          remove(name: string, options: any) {
            cookieStore.set({ name, value: "", ...options });
          },
        },
      }
    );

    const {
      data: { session },
      error,
    } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      return NextResponse.redirect(
        `${requestUrl.origin}/login?error=${error.message}`
      );
    }

    if (!session) {
      return NextResponse.redirect(
        `${requestUrl.origin}/login?error=No session created`
      );
    }

    // Get user's subscription status and daily video count
    const { data: profile } = await supabase
      .from("profiles")
      .select("subscription_status, daily_video_count")
      .eq("id", session.user.id)
      .single();

    // Send message to extension
    const extensionId = process.env.EXTENSION_ID;
    if (extensionId) {
      const success = await sendMessageToExtension(extensionId, {
        type: "AUTH_TOKEN",
        token: session.access_token,
        subscriptionStatus: profile?.subscription_status || "free",
        dailyVideoCount: profile?.daily_video_count || 0,
      });

      if (!success) {
        console.error("Failed to send token to extension");
        // Continue with the redirect even if extension communication fails
        // The extension can retry later when the user opens it
      }
    }

    return NextResponse.redirect(requestUrl.origin);
  }

  return NextResponse.redirect(
    `${requestUrl.origin}/login?error=No code provided`
  );
}
