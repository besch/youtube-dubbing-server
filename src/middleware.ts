import { createMiddlewareClient } from "@supabase/auth-helpers-nextjs";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { updateIpAddress } from "./app/actions/subscription";

export async function middleware(request: NextRequest) {
  const res = NextResponse.next();
  const supabase = createMiddlewareClient({ req: request, res });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Update IP address for authenticated users
  if (user) {
    const ip =
      request.headers.get("x-forwarded-for") || request.ip || "unknown";
    await updateIpAddress({ userId: user.id, ipAddress: ip });
  }

  // Special handling for auth callback - let it pass through
  if (request.nextUrl.pathname.startsWith("/auth/callback")) {
    return res;
  }

  // Only protect subscription-related routes
  if (request.nextUrl.pathname.startsWith("/subscription") && !user) {
    return NextResponse.redirect(new URL("/login", request.url));
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
  ],
};
