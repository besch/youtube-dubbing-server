"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { Button } from "@/components/ui/button";
import { Icons } from "@/components/icons";
import { toast } from "sonner";
import type { Database } from "@/types/supabase";
import { useEffect, useState } from "react";

export function Nav() {
  const pathname = usePathname();
  const supabase = createClientComponentClient<Database>();
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const getUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUser(user);
    };
    getUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, [supabase.auth]);

  const handleSignOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
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
            <span className="font-bold">YouTube Dubbing</span>
          </Link>
          <nav className="flex items-center space-x-6 text-sm font-medium">
            <Link
              href="/"
              className={`transition-colors hover:text-foreground/80 ${
                pathname === "/" ? "text-foreground" : "text-foreground/60"
              }`}
            >
              Home
            </Link>
            <Link
              href="/subscription"
              className={`transition-colors hover:text-foreground/80 ${
                pathname === "/subscription"
                  ? "text-foreground"
                  : "text-foreground/60"
              }`}
            >
              Subscription
            </Link>
            {user && (
              <Link
                href="/profile"
                className={`transition-colors hover:text-foreground/80 ${
                  pathname === "/profile"
                    ? "text-foreground"
                    : "text-foreground/60"
                }`}
              >
                Profile
              </Link>
            )}
          </nav>
        </div>
        <div className="flex flex-1 items-center justify-end space-x-4">
          <nav className="flex items-center space-x-2">
            {user ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSignOut}
                className="text-sm font-medium"
              >
                Sign Out
              </Button>
            ) : (
              <Link href="/login">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-sm font-medium"
                >
                  Sign In
                </Button>
              </Link>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}
