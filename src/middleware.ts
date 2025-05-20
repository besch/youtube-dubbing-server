import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { updateIpAddress } from "./app/actions/subscription";

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name) => req.cookies.get(name)?.value,
        set: (name, value, options) => {
          res.cookies.set({
            name,
            value,
            ...options,
          });
        },
        remove: (name, options) => {
          res.cookies.set({
            name,
            value: "",
            ...options,
          });
        },
      },
    }
  );

  const {
    data: { session },
  } = await supabase.auth.getSession();

  // If user is not signed in and the current path is /profile
  if (!session && req.nextUrl.pathname === "/profile") {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("redirectTo", req.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // Update IP address for authenticated users
  if (session) {
    const ip = req.headers.get("x-forwarded-for") || req.ip || "unknown";
    await updateIpAddress({ userId: session.user.id, ipAddress: ip });
  }

  // Special handling for auth callback - let it pass through
  if (req.nextUrl.pathname.startsWith("/auth/callback")) {
    return res;
  }

  return res;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    "/((?!_next/static|_next/image|favicon.ico|public/).*)",
    "/profile",
  ],
};
