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
  const devAllowedExtensionId = process.env.NEXT_PUBLIC_DEV_EXTENSION_ID;

  if (!allowedExtensionId && !devAllowedExtensionId) {
    console.error(
      "Neither NEXT_PUBLIC_EXTENSION_ID nor NEXT_PUBLIC_DEV_EXTENSION_ID environment variable is set"
    );
    return {
      isValid: false,
      error: new AppError(
        AppErrorCode.UNAUTHORIZED,
        "Extension authentication not configured"
      ),
    };
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    return {
      isValid: false,
      error: new AppError(AppErrorCode.UNAUTHORIZED, "Missing origin header"),
    };
  }

  const expectedOrigin = allowedExtensionId
    ? `chrome-extension://${allowedExtensionId}`
    : null;
  const devExpectedOrigin = devAllowedExtensionId
    ? `chrome-extension://${devAllowedExtensionId}`
    : null;

  let isValidOrigin = false;
  if (expectedOrigin && origin === expectedOrigin) {
    isValidOrigin = true;
  } else if (devExpectedOrigin && origin === devExpectedOrigin) {
    isValidOrigin = true;
  }

  if (!isValidOrigin) {
    console.warn(
      `Unauthorized request from origin: ${origin}, expected: ${
        expectedOrigin || "N/A"
      } or ${devExpectedOrigin || "N/A"}`
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
  requestOrigin: string | null
): Response {
  const headers = new Headers(response.headers);
  const allowedExtensionId = process.env.NEXT_PUBLIC_EXTENSION_ID;
  const devAllowedExtensionId = process.env.NEXT_PUBLIC_DEV_EXTENSION_ID;

  let matchedAllowedOrigin = null;

  if (requestOrigin) {
    if (
      allowedExtensionId &&
      requestOrigin === `chrome-extension://${allowedExtensionId}`
    ) {
      matchedAllowedOrigin = requestOrigin;
    } else if (
      devAllowedExtensionId &&
      requestOrigin === `chrome-extension://${devAllowedExtensionId}`
    ) {
      matchedAllowedOrigin = requestOrigin;
    }
  }

  if (matchedAllowedOrigin) {
    headers.set("Access-Control-Allow-Origin", matchedAllowedOrigin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
    headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Extension-Id"
    );
    headers.set("Access-Control-Max-Age", "86400"); // 24 hours
  } else {
    // This case should ideally not be reached if validateExtensionRequest is called first.
    // If it is reached, it means an unvalidated origin is trying to get CORS headers.
    // We can choose to not set any CORS headers or set a restrictive one.
    // For now, let's log a warning and not set the Allow-Origin header.
    console.warn(
      "setCorsHeaders called with an origin that does not match allowed extension IDs:",
      requestOrigin
    );
    // Optionally, to be more restrictive, you could remove any existing ACAO header if present:
    // headers.delete("Access-Control-Allow-Origin");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
