"use server";

import { z } from "zod";
import { createSafeActionClient } from "next-safe-action";
import type { User } from "@supabase/supabase-js"; // Import User type
import { createServerClient } from "@supabase/ssr"; // Updated Supabase client
import { cookies } from "next/headers"; // For server-side cookie handling
import type { Database } from "@/types/supabase";
import type { ActionResponse } from "@/types/actions";
import { AppError, appErrors } from "@/lib/errors";
import type { LogEntry, LogLevel } from "@/lib/logger";
import { createClient as createSupabaseClient } from "@supabase/supabase-js"; // Specific import for admin client
import { ADMIN_EMAIL } from "@/config/constants"; // Import ADMIN_EMAIL
import {
  getLogsSchema,
  getLogStatsSchema,
  getLogByIdSchema,
  type LogStat,
  getTimeBasedLogStatsSchema,
  type TimeSeriesStatData,
  getUniqueIpActivitySchema,
  type UniqueIpActivityData,
} from "./schemas";

export type { LogStat }; // Re-export LogStat
export type { TimeSeriesStatData }; // Re-export TimeSeriesStatData
export type { UniqueIpActivityData }; // Re-export UniqueIpActivityData

// Helper function to get Supabase admin client (remains unchanged if used for direct DB ops)
function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new AppError(
      appErrors.CONFIGURATION_ERROR.message,
      appErrors.CONFIGURATION_ERROR.code,
      appErrors.CONFIGURATION_ERROR.statusCode
    );
  }
  // This createClient is fine for service role key usage.
  return createSupabaseClient<Database>(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

interface MiddlewareContext {
  isAdmin: boolean;
  userId: string;
}

async function isAdminUser(user: User | null): Promise<boolean> {
  if (!user) {
    return false;
  }
  // Check email and if the provider for the primary identity is Google
  // user.app_metadata.provider stores the first provider used to sign up.
  // user.identities is an array if multiple identities are linked.
  const isCorrectEmail = user.email === ADMIN_EMAIL;
  const hasGoogleIdentity =
    user.identities?.some((id) => id.provider === "google") ?? false;
  const isGoogleProvider =
    user.app_metadata?.provider === "google" || hasGoogleIdentity;

  return isCorrectEmail && isGoogleProvider;
}

const action = createSafeActionClient({
  async middleware(): Promise<MiddlewareContext> {
    const cookieStore = cookies();
    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
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
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      throw new AppError(
        "User is not authenticated.",
        appErrors.UNAUTHORIZED.code,
        appErrors.UNAUTHORIZED.statusCode
      );
    }

    const isAdmin = await isAdminUser(user);
    if (!isAdmin) {
      throw new AppError(
        "User is not authorized to perform this action.",
        appErrors.FORBIDDEN.code,
        appErrors.FORBIDDEN.statusCode
      );
    }
    return { isAdmin: true, userId: user.id };
  },
  handleReturnedServerError(e: Error) {
    if (e instanceof AppError) {
      return {
        serverError: e.message,
        errorCode: e.code,
      };
    }
    console.error("Unhandled error in admin logs action:", e);
    return {
      serverError: appErrors.UNEXPECTED_ERROR.message,
      errorCode: appErrors.UNEXPECTED_ERROR.code,
    };
  },
});

export interface PaginatedLogsResponse {
  logs: LogEntry[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
}

export const getLogsAction = action(getLogsSchema, async (parsedInput) => {
  const {
    page,
    limit,
    startDate,
    endDate,
    logLevel,
    serviceName,
    actionName,
    userId: filterUserId,
    sortBy,
    sortOrder,
  } = parsedInput;
  const supabase = getSupabaseAdminClient();

  let query = supabase
    .from("app_logs")
    .select("*, profiles ( email )", { count: "exact" });

  if (startDate) query = query.gte("created_at", startDate);
  if (endDate) query = query.lte("created_at", endDate);
  if (logLevel) query = query.eq("log_level", logLevel);
  if (serviceName) query = query.ilike("service_name", `%${serviceName}%`);
  if (actionName) query = query.ilike("action_name", `%${actionName}%`);
  if (filterUserId) query = query.eq("user_id", filterUserId);

  query = query.order(sortBy, { ascending: sortOrder === "asc" });
  query = query.range((page - 1) * limit, page * limit - 1);

  const { data, error, count } = await query;

  if (error) {
    console.error("Error fetching logs:", error);
    throw new AppError(
      error.message,
      appErrors.DATABASE_ERROR.code,
      appErrors.DATABASE_ERROR.statusCode
    );
  }

  const logsWithEmail =
    data?.map((log: any) => ({
      ...log,
      user_email: log.profiles?.email,
      profiles: undefined, // Remove the nested profiles object to match LogEntry type
    })) || [];

  return {
    logs: logsWithEmail as LogEntry[],
    totalCount: count || 0,
    totalPages: Math.ceil((count || 0) / limit),
    currentPage: page,
  };
});

export const getLogStatsAction = action(
  getLogStatsSchema,
  async (parsedInput) => {
    const { startDate, endDate, groupBy } = parsedInput;
    const supabase = getSupabaseAdminClient();

    const { data, error } = await supabase.rpc("get_log_stats", {
      p_start_date: startDate,
      p_end_date: endDate,
      p_group_by: groupBy,
    });

    if (error) {
      console.error("Error fetching log stats:", error);
      throw new AppError(
        error.message,
        appErrors.DATABASE_ERROR.code,
        appErrors.DATABASE_ERROR.statusCode
      );
    }

    return data as LogStat[];
  }
);

export const getTimeBasedLogStatsAction = action(
  getTimeBasedLogStatsSchema,
  async (parsedInput) => {
    const { startDate, endDate, granularity } = parsedInput;
    const supabase = getSupabaseAdminClient();

    const { data, error } = await supabase.rpc("get_logs_by_time_granularity", {
      p_granularity: granularity,
      p_start_date: startDate === undefined ? null : startDate,
      p_end_date: endDate === undefined ? null : endDate,
    } as any);

    if (error) {
      console.error(
        `Error fetching time-based log stats (granularity: ${granularity}):`,
        error
      );
      throw new AppError(
        error.message,
        appErrors.DATABASE_ERROR.code,
        appErrors.DATABASE_ERROR.statusCode
      );
    }

    if (!data) {
      console.warn(
        `No data returned from get_logs_by_time_granularity for ${granularity} between ${startDate} and ${endDate}`
      );
      return [];
    }

    const transformedData: TimeSeriesStatData[] = data.map((item: any) => ({
      date: item.time_bucket,
      count: Number(item.log_count),
    }));

    return transformedData;
  }
);

// You might also want an action to get a single log entry by ID
export const getLogByIdAction = action(
  getLogByIdSchema,
  async (parsedInput) => {
    const { id } = parsedInput;
    const supabase = getSupabaseAdminClient();

    const { data, error } = await supabase
      .from("app_logs")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        // Not found
        return null;
      }
      console.error(`Error fetching log by ID (${id}):`, error);
      throw new AppError(
        error.message,
        appErrors.DATABASE_ERROR.code,
        appErrors.DATABASE_ERROR.statusCode
      );
    }
    return data as LogEntry | null;
  }
);

export const getUniqueIpActivityAction = action(
  getUniqueIpActivitySchema,
  async (parsedInput) => {
    const { startDate, endDate, granularity } = parsedInput;
    const supabase = getSupabaseAdminClient();

    const { data, error } = await supabase.rpc("get_unique_ip_activity", {
      p_granularity: granularity,
      p_start_date: startDate === undefined ? null : startDate,
      p_end_date: endDate === undefined ? null : endDate,
    } as any);

    if (error) {
      console.error(
        `Error fetching unique IP activity (granularity: ${granularity}):`,
        error
      );
      throw new AppError(
        error.message,
        appErrors.DATABASE_ERROR.code,
        appErrors.DATABASE_ERROR.statusCode
      );
    }

    if (!data) {
      console.warn(
        `No data returned from get_unique_ip_activity for ${granularity} between ${startDate} and ${endDate}`
      );
      return [];
    }

    // Ensure the RPC response matches the expected structure for UniqueIpActivityData
    // The SQL function returns time_bucket and unique_ip_count
    const transformedData: UniqueIpActivityData[] = data.map((item: any) => ({
      date: item.time_bucket, // time_bucket is already a string from date_trunc
      unique_ip_count: Number(item.unique_ip_count),
    }));

    return transformedData;
  }
);
