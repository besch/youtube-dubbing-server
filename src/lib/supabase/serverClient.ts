import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/supabase"; // Ensure you have this type generated

// Utility function to create a Supabase client for Server Components,
// Server Actions, and Route Handlers that require user authentication.
export async function createSupabaseServerClient() {
  // Validate environment variables
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    throw new Error("Missing env.NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!supabaseAnonKey) {
    throw new Error("Missing env.NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  // Get the cookies instance (it's now async in Next.js 15)
  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name) {
        return cookieStore.get(name)?.value;
      },
      set(name, value, options) {
        cookieStore.set(name, value, { ...options });
      },
      remove(name, options) {
        cookieStore.set(name, "", { ...options, maxAge: 0 });
      },
    },
  });
}

// NEW: Utility function to create a Supabase client using the SERVICE_ROLE_KEY
// for administrative tasks (like deleting users).
// This client bypasses Row Level Security (RLS).
export async function createSupabaseAdminClient() {
  // Validate environment variables
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error("Missing env.NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!supabaseServiceRoleKey) {
    throw new Error("Missing env.SUPABASE_SERVICE_ROLE_KEY");
  }

  // Note: Using createServerClient is generally for interacting with cookies/auth state.
  // For service role actions that don't need user context from cookies, you might
  // consider using the simpler `createClient` from '@supabase/supabase-js',
  // but `createServerClient` works here too, just without cookie handling logic needed.
  return createServerClient<Database>(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      // Important: Specify autoRefreshToken and persistSession to false for service roles
      autoRefreshToken: false,
      persistSession: false,
    },
    // No cookies needed for service role client typically
    cookies: {
      get: () => undefined,
      set: () => {},
      remove: () => {},
    },
  });
}
