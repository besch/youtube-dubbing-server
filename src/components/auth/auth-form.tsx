"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const handleGoogleLogin = async () => {
    try {
      setIsLoading(true);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) throw error;
    } catch (error) {
      toast.error("Failed to sign in with Google");
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      if (authMode === "signIn") {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;

        if (data.session) {
          // Get user's subscription status and daily video count
          const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select(
              "subscription_status, daily_video_count, stripe_customer_id"
            )
            .eq("id", data.session.user.id)
            .single();

          // Redirect to success page with token and profile data (same as OAuth flow)
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

          if (process.env.NEXT_PUBLIC_EXTENSION_ID) {
            redirectUrl.searchParams.append(
              "extension_id",
              process.env.NEXT_PUBLIC_EXTENSION_ID
            );
          }
          if (process.env.NEXT_PUBLIC_DEV_EXTENSION_ID) {
            redirectUrl.searchParams.append(
              "dev_extension_id",
              process.env.NEXT_PUBLIC_DEV_EXTENSION_ID
            );
          }

          window.location.href = redirectUrl.toString();
        }
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
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
      console.error(error);
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
