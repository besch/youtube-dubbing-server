"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

interface ProfileForExtension {
  subscription_status: string;
  daily_video_count: number;
  stripe_customer_id: string | null;
  [key: string]: any;
}

interface ProfileErrorForExtension {
  error: string;
  status: "error";
}

export function AuthCallbackHandler() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [message, setMessage] = useState("Processing your authentication...");

  useEffect(() => {
    const token = searchParams.get("token");
    const profileError = searchParams.get("profile_error");

    const extensionId = searchParams.get("extension_id");
    const devExtensionId = searchParams.get("dev_extension_id");
    const isExtensionFlow = !!(extensionId || devExtensionId);

    if (!token) {
      setMessage(
        "Authentication error: No token received. Please try logging in again."
      );
      setTimeout(() => router.push("/login?error=auth_token_missing"), 3000);
      return;
    }

    const rawProfileData = {
      subscription_status: searchParams.get("subscription_status"),
      daily_video_count: searchParams.get("daily_video_count"),
      stripe_customer_id: searchParams.get("stripe_customer_id"),
    };

    let profileForExtensionPayload:
      | ProfileForExtension
      | ProfileErrorForExtension;

    if (profileError) {
      profileForExtensionPayload = {
        error: "Failed to fetch user profile during login.",
        status: "error",
      };
    } else {
      profileForExtensionPayload = {
        subscription_status: rawProfileData.subscription_status || "free",
        daily_video_count: rawProfileData.daily_video_count
          ? parseInt(rawProfileData.daily_video_count, 10)
          : 0,
        stripe_customer_id: rawProfileData.stripe_customer_id || null,
      };
    }

    if (isExtensionFlow) {
      setMessage(
        "Authentication successful! Securely sending data to the extension. This window will close automatically."
      );

      const targetExtensionId = extensionId || devExtensionId;

      if (targetExtensionId) {
        const payload = {
          type: "AUTH_TOKEN_FROM_SERVER",
          token,
          profile: profileForExtensionPayload,
        };

        const browserWindow = window as any;
        if (
          typeof browserWindow !== "undefined" &&
          browserWindow.chrome &&
          browserWindow.chrome.runtime &&
          browserWindow.chrome.runtime.sendMessage
        ) {
          browserWindow.chrome.runtime.sendMessage(
            targetExtensionId,
            payload,
            (response: any) => {
              if (
                browserWindow.chrome &&
                browserWindow.chrome.runtime &&
                browserWindow.chrome.runtime.lastError
              ) {
                console.warn(
                  "Error sending message to extension:",
                  browserWindow.chrome.runtime.lastError.message
                );
                setMessage(
                  "Data processed. If this window doesn't close automatically, please close it manually."
                );
              } else {
                setMessage(
                  "Data successfully sent to the extension. This window will now close."
                );
              }
              try {
                window.close();
              } catch (e) {
                // console.warn("Could not close window automatically:", e);
              }
            }
          );
        } else {
          setMessage(
            "Cannot send data to extension (Chrome API not available or not in extension context). Please close this window manually."
          );
          try {
            window.close();
          } catch (e) {
            // If it fails, the message above guides the user.
          }
        }
      } else {
        setMessage(
          "Configuration error: Extension ID is missing. Please close this window manually."
        );
        try {
          window.close();
        } catch (e) {}
      }
    } else {
      setMessage("Authentication successful! Redirecting to the homepage...");
      setTimeout(() => {
        router.push("/");
      }, 1500);
    }
  }, [searchParams, router]);

  return (
    <div style={{ fontSize: "1.2em", fontWeight: "bold", marginTop: "20px" }}>
      {message}
    </div>
  );
}
