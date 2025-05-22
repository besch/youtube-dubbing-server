"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

export default function AuthCallbackSuccessPage() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const token = searchParams.get("token");
    const subscriptionStatus = searchParams.get("subscription_status");
    const dailyVideoCount = searchParams.get("daily_video_count");
    const stripeCustomerId = searchParams.get("stripe_customer_id");
    const extensionId = searchParams.get("extension_id");
    const profileError = searchParams.get("profile_error");
    const chromeAPI = (window as any).chrome;

    if (
      chromeAPI &&
      chromeAPI.runtime &&
      chromeAPI.runtime.sendMessage &&
      extensionId &&
      token
    ) {
      const messagePayload: any = {
        type: "AUTH_TOKEN_FROM_SERVER",
        token,
      };

      if (profileError) {
        messagePayload.profileError = true;
      } else {
        messagePayload.profile = {
          subscription_status: subscriptionStatus || "free",
          daily_video_count: parseInt(dailyVideoCount || "0", 10),
          stripe_customer_id: stripeCustomerId || null,
        };
      }

      try {
        chromeAPI.runtime.sendMessage(
          extensionId,
          messagePayload,
          (response: any) => {
            if (chromeAPI.runtime.lastError) {
              console.error(
                "[AuthCallbackSuccessPage] Error sending message to extension:",
                chromeAPI.runtime.lastError.message
              );
            } else {
              console.log(
                "[AuthCallbackSuccessPage] Message sent to extension, response:",
                response
              );
            }
            window.close();
          }
        );
      } catch (error) {
        window.close();
      }
    } else {
      if (!extensionId) console.warn("- Extension ID missing from URL.");
      if (!token) console.warn("- Token missing from URL.");

      window.close();
    }
  }, [searchParams]);

  return (
    <div style={{ padding: "20px", textAlign: "center" }}>
      <h1>Authentication Successful!</h1>
      <p>Processing... this window will attempt to close automatically.</p>
      <p>If it doesn't, please close it manually after a few seconds.</p>
    </div>
  );
}
