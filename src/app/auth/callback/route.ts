import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { Database } from "@/types/supabase";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const initiatorId = requestUrl.searchParams.get("initiator_id");
  console.log(
    "[/auth/callback Server Route] Received initiator_id:",
    initiatorId
  );
  console.log(
    "[/auth/callback Server Route] NEXT_PUBLIC_EXTENSION_ID:",
    process.env.NEXT_PUBLIC_EXTENSION_ID
  );
  console.log(
    "[/auth/callback Server Route] NEXT_PUBLIC_DEV_EXTENSION_ID:",
    process.env.NEXT_PUBLIC_DEV_EXTENSION_ID
  );

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
      let errorRedirectUrl = `${
        requestUrl.origin
      }/login?error=${encodeURIComponent(error.message)}`;
      if (initiatorId) {
        errorRedirectUrl += `&initiator_id=${encodeURIComponent(initiatorId)}`;
      }
      console.error(
        "[/auth/callback Server Route] Code exchange error:",
        error.message
      );
      console.log(
        "[/auth/callback Server Route] Redirecting to (error):".concat(
          errorRedirectUrl
        )
      );
      return NextResponse.redirect(errorRedirectUrl);
    }

    if (!session) {
      let noSessionRedirectUrl = `${requestUrl.origin}/login?error=No session created`;
      if (initiatorId) {
        noSessionRedirectUrl += `&initiator_id=${encodeURIComponent(
          initiatorId
        )}`;
      }
      console.error(
        "[/auth/callback Server Route] No session created after code exchange."
      );
      console.log(
        "[/auth/callback Server Route] Redirecting to (no session):".concat(
          noSessionRedirectUrl
        )
      );
      return NextResponse.redirect(noSessionRedirectUrl);
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("subscription_status, daily_video_count, stripe_customer_id")
      .eq("id", session.user.id)
      .single();

    const redirectUrl = new URL(`${requestUrl.origin}/auth/callback/success`);
    redirectUrl.searchParams.append("token", session.access_token);

    if (profileError) {
      console.error(
        "[/auth/callback Server Route] Error fetching profile:",
        profileError
      );
      redirectUrl.searchParams.append("profile_error", "true");
    } else {
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
    }

    if (
      initiatorId === process.env.NEXT_PUBLIC_EXTENSION_ID &&
      process.env.NEXT_PUBLIC_EXTENSION_ID
    ) {
      console.log(
        "[/auth/callback Server Route] Matched EXTENSION_ID, adding extension_id param."
      );
      redirectUrl.searchParams.append(
        "extension_id",
        process.env.NEXT_PUBLIC_EXTENSION_ID
      );
    } else if (
      initiatorId === process.env.NEXT_PUBLIC_DEV_EXTENSION_ID &&
      process.env.NEXT_PUBLIC_DEV_EXTENSION_ID
    ) {
      console.log(
        "[/auth/callback Server Route] Matched DEV_EXTENSION_ID, adding dev_extension_id param."
      );
      redirectUrl.searchParams.append(
        "dev_extension_id",
        process.env.NEXT_PUBLIC_DEV_EXTENSION_ID
      );
    } else {
      console.log(
        "[/auth/callback Server Route] No extension ID match for initiator_id:",
        initiatorId
      );
    }
    console.log(
      "[/auth/callback Server Route] Final redirectUrl to /success:",
      redirectUrl.toString()
    );
    return NextResponse.redirect(redirectUrl.toString());
  }

  let noCodeRedirectUrl = `${requestUrl.origin}/login?error=No code provided`;
  if (initiatorId) {
    noCodeRedirectUrl += `&initiator_id=${encodeURIComponent(initiatorId)}`;
  }
  console.log(
    "[/auth/callback Server Route] No code provided, redirecting to:".concat(
      noCodeRedirectUrl
    )
  );
  return NextResponse.redirect(noCodeRedirectUrl);
}
