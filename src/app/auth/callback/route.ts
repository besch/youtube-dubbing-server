import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { Database } from "@/types/supabase";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");

  if (!code) {
    console.error("No code provided in callback");
    return NextResponse.redirect(
      `${requestUrl.origin}/login?error=No code provided`
    );
  }

  try {
    const cookieStore = cookies();
    const supabase = createRouteHandlerClient<Database>({
      cookies: () => cookieStore,
    });

    const { error, data } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error("Auth callback error:", error);
      return NextResponse.redirect(
        `${requestUrl.origin}/login?error=Authentication failed`
      );
    }

    if (!data.session) {
      console.error("No session after code exchange");
      return NextResponse.redirect(
        `${requestUrl.origin}/login?error=No session created`
      );
    }

    // Successful authentication
    return NextResponse.redirect(requestUrl.origin);
  } catch (error) {
    console.error("Auth callback error:", error);
    return NextResponse.redirect(
      `${requestUrl.origin}/login?error=Authentication failed`
    );
  }
}
