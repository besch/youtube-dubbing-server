import type { ReactNode } from "react";
import Link from "next/link";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { ADMIN_EMAIL } from "@/config/constants";

interface AdminLayoutProps {
  children: ReactNode;
}

async function verifyAdminAccess(): Promise<void> {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        // set and remove are not strictly needed for just getUser, but good practice to include
        set(name: string, value: string, options: any) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: any) {
          cookieStore.set({ name, value: "", ...options });
        },
      },
    }
  );

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/login?message=Authentication required for admin area.");
  }

  const isCorrectEmail = user.email === ADMIN_EMAIL;
  // Check app_metadata.provider or identities for 'google'
  const isGoogleProvider =
    user.app_metadata?.provider === "google" ||
    (user.identities && user.identities.some((id) => id.provider === "google"));

  if (!(isCorrectEmail && isGoogleProvider)) {
    redirect("/login?message=Unauthorized access to admin area.");
  }
}

// Basic Admin Layout with very simple navigation
// TODO: Add proper authentication and authorization checks here to protect admin routes.
// For example, redirect if the user is not an admin.
export default async function AdminLayout({ children }: AdminLayoutProps) {
  await verifyAdminAccess(); // Call the verification function

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 max-w-screen-2xl items-center">
          <div className="mr-4 hidden md:flex">
            <Link href="/" className="mr-6 flex items-center space-x-2">
              {/* <Icons.logo className="h-6 w-6" /> Replace with your logo component */}
              <span className="hidden font-bold sm:inline-block">
                MyApp Admin
              </span>
            </Link>
            <nav className="flex items-center gap-6 text-sm">
              <Link
                href="/dashboard/logs"
                className="text-foreground/60 transition-colors hover:text-foreground/80"
              >
                App Logs
              </Link>
              {/* Add other admin navigation links here */}
            </nav>
          </div>
        </div>
      </header>
      <main className="flex-1 container max-w-screen-2xl py-8">{children}</main>
      <footer className="py-6 md:px-8 md:py-0 bg-background border-t border-border/40">
        <div className="container flex flex-col items-center justify-between gap-4 md:h-24 md:flex-row">
          <p className="text-balance text-center text-sm leading-loose text-muted-foreground md:text-left">
            Admin Panel
          </p>
        </div>
      </footer>
    </div>
  );
}
