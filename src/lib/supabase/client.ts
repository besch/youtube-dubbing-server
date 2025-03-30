import { createBrowserClient } from "@supabase/ssr"; // Using ssr helper for browser client
import type { Database } from "@/types/supabase";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  throw new Error("Missing env.NEXT_PUBLIC_SUPABASE_URL");
}
if (!supabaseAnonKey) {
  throw new Error("Missing env.NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

// Use createBrowserClient for client-side usage (React components, etc.)
// It uses the anonymous key and respects RLS policies for the logged-in user.
export const supabaseBrowserClient = createBrowserClient<Database>(
  supabaseUrl,
  supabaseAnonKey
);
