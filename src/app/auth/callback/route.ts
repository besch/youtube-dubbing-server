import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { Database } from "@/types/supabase";

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
        `${requestUrl.origin}/login?error=${encodeURIComponent(error.message)}`
      );
    }

    if (!session) {
      return NextResponse.redirect(
        `${requestUrl.origin}/login?error=No session created`
      );
    }

    // Get user's subscription status and daily video count
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("subscription_status, daily_video_count, stripe_customer_id")
      .eq("id", session.user.id)
      .single();

    if (profileError) {
      console.error("Error fetching profile:", profileError);
      // Redirect to a success page but indicate profile fetch failed,
      // extension can then decide to prompt user or retry fetching profile later.
      const redirectUrl = new URL(`${requestUrl.origin}/auth/callback/success`);
      redirectUrl.searchParams.append("token", session.access_token);
      redirectUrl.searchParams.append("profile_error", "true");
      if (process.env.NEXT_PUBLIC_EXTENSION_ID) {
        redirectUrl.searchParams.append(
          "extension_id",
          process.env.NEXT_PUBLIC_EXTENSION_ID
        );
      }
      return NextResponse.redirect(redirectUrl.toString());
    }

    const redirectUrl = new URL(`${requestUrl.origin}/auth/callback/success`);
    redirectUrl.searchParams.append("token", session.access_token);
    redirectUrl.searchParams.append(
      "subscription_status",
      profile?.subscription_status || "free"
    );
    redirectUrl.searchParams.append(
      "daily_video_count",
      (profile?.daily_video_count || 0).toString()
    );
    redirectUrl.searchParams.append(
      "stripe_customer_id",
      profile?.stripe_customer_id || ""
    );
    if (process.env.NEXT_PUBLIC_EXTENSION_ID) {
      redirectUrl.searchParams.append(
        "extension_id",
        process.env.NEXT_PUBLIC_EXTENSION_ID
      );
    }

    return NextResponse.redirect(redirectUrl.toString());
  }

  return NextResponse.redirect(
    `${requestUrl.origin}/login?error=No code provided`
  );
}
