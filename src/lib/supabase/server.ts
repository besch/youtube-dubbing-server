import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase"; // Assuming you'll generate types from your schema

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error("Missing env.NEXT_PUBLIC_SUPABASE_URL");
}
if (!supabaseServiceRoleKey) {
  // In production, service role key should always be present.
  // Log an error or throw depending on your error handling strategy.
  console.error(
    "Missing env.SUPABASE_SERVICE_ROLE_KEY - Client-side operations may be limited."
  );
  // For server-side actions, this should likely be a hard error:
  throw new Error(
    "Missing env.SUPABASE_SERVICE_ROLE_KEY required for server client"
  );
}

// Note: This client uses the SERVICE ROLE KEY and should only be used on the server.
// Never expose this key in client-side code.
export const supabaseServerClient = createClient<Database>(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    auth: {
      // Suitable for server-side operations like server components, API routes, server actions
      autoRefreshToken: false,
      persistSession: false,
      // detectSessionInUrl: false // Generally not needed for server client
    },
  }
);

// You might also want a client for user-specific server actions that respects RLS
// This requires passing the user's JWT or using the auth helper
// For now, the service role client covers administrative tasks like storage uploads
// and table updates where RLS might be bypassed intentionally.
