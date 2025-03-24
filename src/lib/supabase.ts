import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { config } from "@/config";
import { Database } from "@/types/supabase";

// Server-side Supabase client (uses cookie auth)
export function createServerClient() {
  const cookieStore = cookies();

  return createClient<Database>(config.supabase.url, config.supabase.anonKey, {
    auth: {
      persistSession: false,
      detectSessionInUrl: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        Cookie: cookieStore.toString(),
      },
    },
  });
}

// Admin client for server-side operations that need privileged access
export function createAdminClient() {
  return createClient<Database>(
    config.supabase.url,
    config.supabase.serviceRoleKey,
    {
      auth: {
        persistSession: false,
        detectSessionInUrl: false,
        autoRefreshToken: false,
      },
    }
  );
}

// Client-side Supabase client
export const createBrowserClient = () => {
  return createClient<Database>(config.supabase.url, config.supabase.anonKey, {
    auth: {
      persistSession: true,
      detectSessionInUrl: true,
      autoRefreshToken: true,
    },
  });
};
