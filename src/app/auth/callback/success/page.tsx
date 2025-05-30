"use client";

import { Suspense } from "react";
import { AuthCallbackHandler } from "./auth-callback-handler";

export default function AuthCallbackSuccessPage() {
  return (
    <div style={{ padding: "20px", textAlign: "center" }}>
      <h1>Authentication Callback</h1>
      <Suspense fallback={<div>Loading authentication details...</div>}>
        <AuthCallbackHandler />
      </Suspense>
    </div>
  );
}
