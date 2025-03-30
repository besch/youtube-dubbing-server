import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/supabase"; // Ensure you have this type generated

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  throw new Error("Missing env.NEXT_PUBLIC_SUPABASE_URL");
}
if (!supabaseAnonKey) {
  throw new Error("Missing env.NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

// Use createBrowserClient for client components
export const supabaseBrowserClient = createBrowserClient<Database>(
  supabaseUrl,
  supabaseAnonKey
);
