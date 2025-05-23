"use client";

import { Suspense } from "react";
import { AuthCallbackHandler } from "./auth-callback-handler";

export default function AuthCallbackSuccessPage() {
  return (
    <div style={{ padding: "20px", textAlign: "center" }}>
      <h1>Authentication Successful!</h1>
      <p>Processing... this window will attempt to close automatically.</p>
      <p>If it doesn't, please close it manually after a few seconds.</p>

      <Suspense fallback={<div>Loading...</div>}>
        <AuthCallbackHandler />
      </Suspense>
    </div>
  );
}
