"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icons } from "@/components/icons";
import { toast } from "sonner";
import type { Database } from "@/types/supabase";

type AuthMode = "signIn" | "signUp";

export function AuthForm() {
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>("signIn");
  const [showConfirmationMessage, setShowConfirmationMessage] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    const currentInitiatorId = searchParams.get("initiator_id");
    console.log(
      "[AuthForm - Google] initiator_id from URL:",
      currentInitiatorId
    );
    try {
      if (currentInitiatorId) {
        // Set a cookie for initiator_id before redirecting to Google
        const cookieName = "oauth_initiator_id";
        const cookieValue = encodeURIComponent(currentInitiatorId);
        const cookieMaxAge = 60 * 5; // 5 minutes
        document.cookie = `${cookieName}=${cookieValue}; path=/; max-age=${cookieMaxAge}; SameSite=Lax`;
        console.log(
          `[AuthForm - Google] Set cookie: ${cookieName}=${cookieValue}`
        );
      } else {
        // Ensure old cookie is cleared if no initiator_id is present
        document.cookie =
          "oauth_initiator_id=; path=/; max-age=0; SameSite=Lax";
      }

      // The redirectTo for Supabase should be your server-side /auth/callback
      // It will later read the initiator_id from the cookie.
      const googleRedirectTo = `${window.location.origin}/auth/callback`;
      console.log(
        "[AuthForm - Google] redirectTo for Supabase:",
        googleRedirectTo
      );

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: googleRedirectTo,
        },
      });

      if (error) throw error;
    } catch (error) {
      toast.error("Failed to sign in with Google");
      console.error("[AuthForm - Google] Error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    const currentInitiatorId = searchParams.get("initiator_id");
    // For email auth, query param method should still work, but we ensure cookie is not set/misused
    document.cookie = "oauth_initiator_id=; path=/; max-age=0; SameSite=Lax"; // Clear oauth cookie

    console.log(
      "[AuthForm - Email] initiator_id from URL:",
      currentInitiatorId
    );
    console.log(
      "[AuthForm - Email] NEXT_PUBLIC_EXTENSION_ID:",
      process.env.NEXT_PUBLIC_EXTENSION_ID
    );
    console.log(
      "[AuthForm - Email] NEXT_PUBLIC_DEV_EXTENSION_ID:",
      process.env.NEXT_PUBLIC_DEV_EXTENSION_ID
    );

    try {
      if (authMode === "signIn") {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;

        if (data.session) {
          const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select(
              "subscription_status, daily_video_count, stripe_customer_id"
            )
            .eq("id", data.session.user.id)
            .single();

          const redirectUrl = new URL(
            `${window.location.origin}/auth/callback/success`
          );
          redirectUrl.searchParams.append("token", data.session.access_token);

          if (profileError) {
            redirectUrl.searchParams.append("profile_error", "true");
          } else {
            redirectUrl.searchParams.append(
              "subscription_status",
              profile?.subscription_status || "free"
            );
            redirectUrl.searchParams.append(
              "daily_video_count",
              (profile?.daily_video_count || 0).toString()
            );
            redirectUrl.searchParams.append(
              "stripe_customer_id",
              profile?.stripe_customer_id || ""
            );
          }

          if (
            currentInitiatorId === process.env.NEXT_PUBLIC_EXTENSION_ID &&
            process.env.NEXT_PUBLIC_EXTENSION_ID
          ) {
            console.log(
              "[AuthForm - Email] Matched EXTENSION_ID, adding extension_id param."
            );
            redirectUrl.searchParams.append(
              "extension_id",
              process.env.NEXT_PUBLIC_EXTENSION_ID
            );
          } else if (
            currentInitiatorId === process.env.NEXT_PUBLIC_DEV_EXTENSION_ID &&
            process.env.NEXT_PUBLIC_DEV_EXTENSION_ID
          ) {
            console.log(
              "[AuthForm - Email] Matched DEV_EXTENSION_ID, adding dev_extension_id param."
            );
            redirectUrl.searchParams.append(
              "dev_extension_id",
              process.env.NEXT_PUBLIC_DEV_EXTENSION_ID
            );
          } else {
            console.log(
              "[AuthForm - Email] No extension ID match for initiator_id from URL:",
              currentInitiatorId
            );
          }
          console.log(
            "[AuthForm - Email] Final redirectUrl for signIn:",
            redirectUrl.toString()
          );
          window.location.href = redirectUrl.toString();
        }
      } else {
        // Sign Up flow
        // For email sign-up, the confirmation link will go to /auth/callback.
        // We need initiator_id there too, so we use the cookie method like Google OAuth.
        let emailRedirectToServerCallback = `${window.location.origin}/auth/callback`;
        if (currentInitiatorId) {
          document.cookie = `oauth_initiator_id=${encodeURIComponent(
            currentInitiatorId
          )}; path=/; max-age=${60 * 15}; SameSite=Lax`; // 15 min for email confirmation
          console.log(
            `[AuthForm - SignUp] Set cookie for email confirmation: oauth_initiator_id=${currentInitiatorId}`
          );
        } else {
          document.cookie =
            "oauth_initiator_id=; path=/; max-age=0; SameSite=Lax";
        }
        console.log(
          "[AuthForm - SignUp] emailRedirectTo for Supabase (points to server /auth/callback):".concat(
            emailRedirectToServerCallback
          )
        );

        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: emailRedirectToServerCallback, // Supabase will append code etc. to this
          },
        });

        if (error) throw error;
        toast.success(
          "Sign up successful! Please check your email to confirm."
        );
        setShowConfirmationMessage(true);
        setEmail("");
        setPassword("");
      }
    } catch (error) {
      toast.error(
        authMode === "signIn"
          ? "Failed to sign in with email"
          : "Failed to sign up with email"
      );
      console.error("[AuthForm - Email/SignUp] Error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="grid gap-6">
      {showConfirmationMessage ? (
        <div className="text-center space-y-2">
          <h3 className="text-lg font-semibold">Check your email</h3>
          <p className="text-sm text-muted-foreground">
            We've sent a confirmation link to <strong>{email}</strong>. Please
            check your inbox (and spam folder) to complete your registration.
          </p>
          <Button
            onClick={() => {
              setShowConfirmationMessage(false);
              setAuthMode("signIn");
            }}
            className="mt-4"
          >
            Back to Sign In
          </Button>
        </div>
      ) : (
        <>
          <div className="grid gap-2">
            <div className="grid gap-1">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                placeholder="name@example.com"
                type="email"
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect="off"
                disabled={isLoading || showConfirmationMessage}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                placeholder="Enter your password"
                type="password"
                autoComplete="current-password"
                disabled={isLoading || showConfirmationMessage}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button
              onClick={handleEmailAuth}
              disabled={isLoading || showConfirmationMessage}
              className="mt-2"
            >
              {isLoading && (
                <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
              )}
              {authMode === "signIn"
                ? "Sign In with Email"
                : "Sign Up with Email"}
            </Button>
          </div>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Or continue with
              </span>
            </div>
          </div>
          <Button
            variant="default"
            type="button"
            disabled={isLoading || showConfirmationMessage}
            onClick={handleGoogleLogin}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {isLoading && authMode === "signIn" ? (
              <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Icons.google className="mr-2 h-4 w-4" />
            )}
            Google
          </Button>
          <Button
            variant="link"
            onClick={() =>
              setAuthMode(authMode === "signIn" ? "signUp" : "signIn")
            }
            disabled={isLoading || showConfirmationMessage}
            className="text-sm"
          >
            {authMode === "signIn"
              ? "Don't have an account? Sign Up"
              : "Already have an account? Sign In"}
          </Button>
        </>
      )}
    </div>
  );
}
