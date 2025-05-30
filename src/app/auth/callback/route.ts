import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { Database } from "@/types/supabase";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const cookieStore = cookies();
  const redirectTo = requestUrl.searchParams.get("redirect_to");

  // Try to get initiator_id from the cookie first
  let initiatorId = cookieStore.get("oauth_initiator_id")?.value || null;
  if (initiatorId) {
    initiatorId = decodeURIComponent(initiatorId);
    console.log(
      "[/auth/callback Server Route] Received initiator_id from cookie:",
      initiatorId
    );
    // Delete the cookie immediately after reading
    cookieStore.set("oauth_initiator_id", "", { path: "/", maxAge: 0 });
  } else {
    // Fallback to query parameter if cookie is not found (e.g., for direct email sign-in redirect to /success)
    // This path might not be strictly necessary if all OAuth/email-confirm flows use the cookie.
    initiatorId = requestUrl.searchParams.get("initiator_id");
    console.log(
      "[/auth/callback Server Route] initiator_id from cookie NOT FOUND, received from query param (if any):",
      initiatorId
    );
  }

  console.log(
    "[/auth/callback Server Route] Effective initiator_id for this request:",
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
    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
          set(name: string, value: string, options: CookieOptions) {
            cookieStore.set({ name, value, ...options });
          },
          remove(name: string, options: CookieOptions) {
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
      if (redirectTo) {
        errorRedirectUrl += `&redirect_to=${encodeURIComponent(redirectTo)}`;
      }
      // No need to append initiator_id here anymore as login page will read from its own URL if set by extension
      console.error(
        "[/auth/callback Server Route] Code exchange error:",
        error.message
      );
      console.log(
        "[/auth/callback Server Route] Redirecting to (error):",
        errorRedirectUrl
      );
      return NextResponse.redirect(errorRedirectUrl);
    }

    if (!session) {
      let noSessionRedirectUrl = `${requestUrl.origin}/login?error=No session created`;
      if (redirectTo) {
        noSessionRedirectUrl += `&redirect_to=${encodeURIComponent(
          redirectTo
        )}`;
      }
      // No need to append initiator_id here
      console.error(
        "[/auth/callback Server Route] No session created after code exchange."
      );
      console.log(
        "[/auth/callback Server Route] Redirecting to (no session):",
        noSessionRedirectUrl
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

    // Use the initiatorId obtained from cookie (or query as fallback)
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
      console.log(
        "[/auth/callback Server Route] Final redirectUrl to /success (for extension):",
        redirectUrl.toString()
      );
      return NextResponse.redirect(redirectUrl.toString());
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
      console.log(
        "[/auth/callback Server Route] Final redirectUrl to /success (for dev extension):",
        redirectUrl.toString()
      );
      return NextResponse.redirect(redirectUrl.toString());
    } else if (redirectTo && redirectTo.startsWith("/")) {
      // If redirectTo is a valid relative path, redirect there
      const finalRedirectUrl = new URL(redirectTo, requestUrl.origin);
      // We might want to pass session info to this page too, if needed, similar to /auth/callback/success
      // For now, just redirecting. Consider if token/profile info needs to be on this URL.
      console.log(
        "[/auth/callback Server Route] Redirecting to specified redirectTo:",
        finalRedirectUrl.toString()
      );
      return NextResponse.redirect(finalRedirectUrl.toString());
    } else {
      // Default redirect to home page if no specific redirect or extension match
      console.log(
        "[/auth/callback Server Route] No extension ID match or specific redirectTo, redirecting to home (/):"
      );
      return NextResponse.redirect(new URL("/", requestUrl.origin).toString());
    }
  }

  // Fallback for no code (preserve redirectTo if present)
  let noCodeRedirectUrl = `${requestUrl.origin}/login?error=No code provided`;
  const redirectToParamForNoCode = requestUrl.searchParams.get("redirect_to");
  if (redirectToParamForNoCode) {
    noCodeRedirectUrl += `&redirect_to=${encodeURIComponent(
      redirectToParamForNoCode
    )}`;
  }
  console.log(
    "[/auth/callback Server Route] No code provided, redirecting to:",
    noCodeRedirectUrl
  );
  return NextResponse.redirect(noCodeRedirectUrl);
}
