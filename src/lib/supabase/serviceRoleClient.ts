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
    "Missing env.SUPABASE_SERVICE_ROLE_KEY - operations requiring service role will fail."
  );
  // For server-side actions requiring elevated privileges, this should likely be a hard error:
  throw new Error(
    "Missing env.SUPABASE_SERVICE_ROLE_KEY required for service role client"
  );
}

// Note: This client uses the SERVICE ROLE KEY and should only be used on the server
// for operations requiring elevated privileges or bypassing RLS (e.g., internal jobs,
// accessing private storage buckets, specific table updates).
// Never expose this key in client-side code.
export const supabaseServiceRoleClient = createClient<Database>(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    auth: {
      // Suitable for server-side operations like cron jobs, specific API routes
      autoRefreshToken: false,
      persistSession: false,
      // detectSessionInUrl: false // Generally not needed for server client
    },
  }
);
