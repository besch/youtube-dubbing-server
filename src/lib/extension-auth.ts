import { NextRequest } from "next/server";
import { AppError, AppErrorCode } from "@/app/actions/actions";

interface ExtensionAuthResult {
  isValid: boolean;
  error?: AppError;
}

/**
 * Validates that the request is coming from the authorized Chrome extension
 */
export function validateExtensionRequest(
  request: NextRequest
): ExtensionAuthResult {
  const allowedExtensionId = process.env.NEXT_PUBLIC_EXTENSION_ID;

  if (!allowedExtensionId) {
    console.error("NEXT_PUBLIC_EXTENSION_ID environment variable is not set");
    return {
      isValid: false,
      error: new AppError(
        AppErrorCode.UNAUTHORIZED,
        "Extension authentication not configured"
      ),
    };
  }

  // Check Origin header for Chrome extension
  const origin = request.headers.get("origin");
  const expectedOrigin = `chrome-extension://${allowedExtensionId}`;

  if (!origin) {
    return {
      isValid: false,
      error: new AppError(AppErrorCode.UNAUTHORIZED, "Missing origin header"),
    };
  }

  if (origin !== expectedOrigin) {
    console.warn(
      `Unauthorized request from origin: ${origin}, expected: ${expectedOrigin}`
    );
    return {
      isValid: false,
      error: new AppError(AppErrorCode.UNAUTHORIZED, "Unauthorized origin"),
    };
  }

  // Additional security: Check User-Agent for Chrome extension pattern
  const userAgent = request.headers.get("user-agent");
  if (userAgent && !userAgent.includes("Chrome")) {
    console.warn(`Suspicious user agent: ${userAgent}`);
    return {
      isValid: false,
      error: new AppError(AppErrorCode.UNAUTHORIZED, "Invalid user agent"),
    };
  }

  return { isValid: true };
}

/**
 * Sets CORS headers for Chrome extension requests
 */
export function setCorsHeaders(
  response: Response,
  extensionId: string
): Response {
  const headers = new Headers(response.headers);

  headers.set(
    "Access-Control-Allow-Origin",
    `chrome-extension://${extensionId}`
  );
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Max-Age", "86400"); // 24 hours

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
