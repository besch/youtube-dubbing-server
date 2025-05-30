"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icons } from "@/components/icons";
import { toast } from "sonner";
import type { Database } from "@/types/supabase";
import { useEffect, useState } from "react";
import { UserCircle } from "lucide-react";
import { ADMIN_EMAIL } from "@/config/constants";

export function Nav() {
  const pathname = usePathname();
  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const [user, setUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const checkUser = async () => {
      const {
        data: { user: supabaseUser },
      } = await supabase.auth.getUser();
      setUser(supabaseUser);
      if (supabaseUser) {
        const isCorrectEmail = supabaseUser.email === ADMIN_EMAIL;
        const isGoogleProvider =
          supabaseUser.app_metadata?.provider === "google" ||
          (supabaseUser.identities?.some((id) => id.provider === "google") ??
            false);
        setIsAdmin(isCorrectEmail && isGoogleProvider);
      } else {
        setIsAdmin(false);
      }
    };
    checkUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const sessionUser = session?.user ?? null;
      setUser(sessionUser);
      if (sessionUser) {
        const isCorrectEmail = sessionUser.email === ADMIN_EMAIL;
        const isGoogleProvider =
          sessionUser.app_metadata?.provider === "google" ||
          (sessionUser.identities?.some((id) => id.provider === "google") ??
            false);
        setIsAdmin(isCorrectEmail && isGoogleProvider);
      } else {
        setIsAdmin(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [supabase.auth]);

  const handleSignOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setUser(null);
      window.location.href = "/";
    } catch (error) {
      toast.error("Failed to sign out");
      console.error(error);
    }
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center">
        <div className="mr-4 flex">
          <Link href="/" className="mr-6 flex items-center space-x-2">
            <Icons.logo className="h-6 w-6" />
            <span className="font-bold">Dubabase</span>
          </Link>
          <nav className="flex items-center space-x-6 text-sm font-medium">
            <Link
              href="/subscription"
              className={`transition-colors hover:text-foreground/80 ${
                pathname === "/subscription" || pathname === "/pricing"
                  ? "text-foreground"
                  : "text-foreground/60"
              }`}
            >
              Pricing
            </Link>
            <Link
              href="/privacy"
              className={`transition-colors hover:text-foreground/80 ${
                pathname === "/privacy"
                  ? "text-foreground"
                  : "text-foreground/60"
              }`}
            >
              Privacy
            </Link>
            <Link
              href="/support"
              className={`transition-colors hover:text-foreground/80 ${
                pathname === "/support"
                  ? "text-foreground"
                  : "text-foreground/60"
              }`}
            >
              Support
            </Link>
            {isAdmin && (
              <Link
                href="/dashboard/logs"
                className={`transition-colors hover:text-foreground/80 ${
                  pathname === "/dashboard/logs"
                    ? "text-foreground"
                    : "text-foreground/60"
                }`}
              >
                Logs
              </Link>
            )}
          </nav>
        </div>
        <div className="flex flex-1 items-center justify-end space-x-4">
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full">
                  <UserCircle className="h-6 w-6 text-neutral-300 hover:text-white" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuItem asChild>
                  <Link href="/profile">Profile</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/subscription">Subscription</Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleSignOut}
                  className="cursor-pointer"
                >
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Link href="/login">
              <Button variant="ghost" size="sm" className="text-sm font-medium">
                Sign In
              </Button>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
