import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const url = request.nextUrl.clone();
  const userAgent = request.headers.get("user-agent") || "";
  const isMobileApp =
    userAgent.includes("Expo") ||
    userAgent.includes("expo") ||
    userAgent.includes("ReactNative");

  // If this is a request from the mobile app to the API routes, let it through
  if (url.pathname.startsWith("/api/") || url.pathname.includes("/_next/")) {
    return NextResponse.next();
  }

  // If it's the root path
  if (url.pathname === "/") {
    if (isMobileApp) {
      // Mobile apps should get JSON API responses
      return NextResponse.json({
        success: true,
        message: "YouTube Dubbing API is running",
        version: "1.0.0",
      });
    } else {
      // Web browsers should be redirected to the home page
      url.pathname = "/home";
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/api/:path*"],
};
