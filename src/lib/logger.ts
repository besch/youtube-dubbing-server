import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/supabase"; // Assuming you have supabase types generated

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";

export interface LogEntry {
  id?: string;
  created_at?: string;
  log_level: LogLevel;
  service_name: string; // e.g., 'auth', 'subtitles', 'audio', 'payments', 'search'
  action_name: string; // e.g., 'login_google', 'fetch_youtube_srt', 'generate_tts_openai'
  user_id?: string;
  session_id?: string;
  ip_address?: string;
  request_payload?: Json;
  response_status_code?: number;
  response_payload?: Json;
  duration_ms?: number;
  error_code?: string;
  error_message?: string;
  stack_trace?: string;
  tags?: Json; // e.g., ["critical", "external_api_dependency"]
  metadata?: Json; // Any other structured data
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  console.error("Logger Error: NEXT_PUBLIC_SUPABASE_URL is not defined.");
}
if (!supabaseServiceRoleKey) {
  console.error("Logger Error: SUPABASE_SERVICE_ROLE_KEY is not defined.");
}

// Create a Supabase client for server-side logging (using service_role key)
// Ensure this client is ONLY used on the server.
const supabaseAdmin =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient<Database>(supabaseUrl, supabaseServiceRoleKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    : null;

async function logToSupabase(entry: LogEntry): Promise<void> {
  if (!supabaseAdmin) {
    console.error(
      "Supabase client for logging is not initialized. Log entry not sent:",
      entry
    );
    return;
  }

  try {
    const { error } = await supabaseAdmin.from("app_logs").insert([entry]);
    if (error) {
      console.error(
        "Failed to insert log into Supabase:",
        error,
        "Original entry:",
        entry
      );
    }
  } catch (e) {
    console.error(
      "Exception while inserting log into Supabase:",
      e,
      "Original entry:",
      entry
    );
  }
}

function createLogger(serviceName: string) {
  return {
    debug: (
      actionName: string,
      details: Omit<LogEntry, "log_level" | "service_name" | "action_name">
    ) =>
      logToSupabase({
        ...details,
        log_level: "DEBUG",
        service_name: serviceName,
        action_name: actionName,
      }),
    info: (
      actionName: string,
      details: Omit<LogEntry, "log_level" | "service_name" | "action_name">
    ) =>
      logToSupabase({
        ...details,
        log_level: "INFO",
        service_name: serviceName,
        action_name: actionName,
      }),
    warn: (
      actionName: string,
      details: Omit<LogEntry, "log_level" | "service_name" | "action_name">
    ) =>
      logToSupabase({
        ...details,
        log_level: "WARN",
        service_name: serviceName,
        action_name: actionName,
      }),
    error: (
      actionName: string,
      details: Omit<LogEntry, "log_level" | "service_name" | "action_name">
    ) =>
      logToSupabase({
        ...details,
        log_level: "ERROR",
        service_name: serviceName,
        action_name: actionName,
      }),
    fatal: (
      actionName: string,
      details: Omit<LogEntry, "log_level" | "service_name" | "action_name">
    ) =>
      logToSupabase({
        ...details,
        log_level: "FATAL",
        service_name: serviceName,
        action_name: actionName,
      }),
  };
}

// Example usage:
// const authLogger = createLogger('auth');
// authLogger.info('user_login_success', { user_id: 'some-uuid', ip_address: '1.2.3.4' });
// authLogger.error('user_login_failure', { error_code: 'INVALID_CREDENTIALS', error_message: 'Login failed' });

export { createLogger, logToSupabase };
