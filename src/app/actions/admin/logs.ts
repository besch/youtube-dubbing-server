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
import { createLogger } from "@/lib/logger"; // Import logger
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
  getRequestVolumeSchema,
  getTopActiveIpsSchema,
  getServicePerformanceSchema,
  getErrorTrendsSchema,
  getUserActivityPatternsSchema,
  getIpActivityDetailSchema,
  getFilteredLogsSchema,
  type RequestVolumeData,
  type TopActiveIpData,
  type ServicePerformanceData,
  type ErrorTrendsData,
  type UserActivityData,
  type IpActivityDetailData,
} from "./schemas";

export type { LogStat }; // Re-export LogStat
export type { TimeSeriesStatData }; // Re-export TimeSeriesStatData
export type { UniqueIpActivityData }; // Re-export UniqueIpActivityData
export type { RequestVolumeData }; // Re-export RequestVolumeData
export type { TopActiveIpData }; // Re-export TopActiveIpData
export type { ServicePerformanceData }; // Re-export ServicePerformanceData
export type { ErrorTrendsData }; // Re-export ErrorTrendsData
export type { UserActivityData }; // Re-export UserActivityData
export type { IpActivityDetailData }; // Re-export IpActivityDetailData

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
  ipAddress?: string;
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

    // Try to get IP address from headers (for API route usage)
    const headers =
      cookieStore.constructor.name === "RequestCookies"
        ? (cookieStore as any).request?.headers
        : null;
    const ipAddress =
      headers?.get("x-forwarded-for")?.split(",")[0] ||
      headers?.get("x-real-ip") ||
      headers?.get("cf-connecting-ip") ||
      undefined;

    return { isAdmin: true, userId: user.id, ipAddress };
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

// Enhanced Analytics Actions

export const getRequestVolumeAction = action(
  getRequestVolumeSchema,
  async (parsedInput) => {
    const { startDate, endDate, granularity } = parsedInput;
    const supabase = getSupabaseAdminClient();

    const { data, error } = await (supabase as any).rpc(
      "get_request_volume_over_time",
      {
        p_granularity: granularity,
        p_start_date: startDate === undefined ? null : startDate,
        p_end_date: endDate === undefined ? null : endDate,
      }
    );

    if (error) {
      console.error(`Error fetching request volume (${granularity}):`, error);
      throw new AppError(
        error.message,
        appErrors.DATABASE_ERROR.code,
        appErrors.DATABASE_ERROR.statusCode
      );
    }

    return ((data as any[]) || []).map((item: any) => ({
      time_bucket: item.time_bucket,
      total_requests: Number(item.total_requests),
      unique_users: Number(item.unique_users),
      unique_ips: Number(item.unique_ips),
      error_requests: Number(item.error_requests),
      avg_duration_ms: Number(item.avg_duration_ms || 0),
    })) as RequestVolumeData[];
  }
);

export const getTopActiveIpsAction = action(
  getTopActiveIpsSchema,
  async (parsedInput) => {
    const { startDate, endDate, limit } = parsedInput;
    const supabase = getSupabaseAdminClient();

    const { data, error } = await (supabase as any).rpc("get_top_active_ips", {
      p_start_date: startDate === undefined ? null : startDate,
      p_end_date: endDate === undefined ? null : endDate,
      p_limit: limit,
    });

    if (error) {
      console.error("Error fetching top active IPs:", error);
      throw new AppError(
        error.message,
        appErrors.DATABASE_ERROR.code,
        appErrors.DATABASE_ERROR.statusCode
      );
    }

    return ((data as any[]) || []).map((item: any) => ({
      ip_address: item.ip_address,
      total_requests: Number(item.total_requests),
      unique_actions: Number(item.unique_actions),
      unique_services: Number(item.unique_services),
      error_count: Number(item.error_count),
      error_rate: Number(item.error_rate),
      avg_duration_ms: Number(item.avg_duration_ms || 0),
      first_seen: item.first_seen,
      last_seen: item.last_seen,
    })) as TopActiveIpData[];
  }
);

export const getServicePerformanceAction = action(
  getServicePerformanceSchema,
  async (parsedInput) => {
    const { startDate, endDate } = parsedInput;
    const supabase = getSupabaseAdminClient();

    const { data, error } = await (supabase as any).rpc(
      "get_service_performance_metrics",
      {
        p_start_date: startDate === undefined ? null : startDate,
        p_end_date: endDate === undefined ? null : endDate,
      }
    );

    if (error) {
      console.error("Error fetching service performance:", error);
      throw new AppError(
        error.message,
        appErrors.DATABASE_ERROR.code,
        appErrors.DATABASE_ERROR.statusCode
      );
    }

    return ((data as any[]) || []).map((item: any) => ({
      service_name: item.service_name,
      total_requests: Number(item.total_requests),
      avg_duration_ms: Number(item.avg_duration_ms || 0),
      p95_duration_ms: Number(item.p95_duration_ms || 0),
      error_count: Number(item.error_count),
      error_rate: Number(item.error_rate),
      unique_users: Number(item.unique_users),
      unique_ips: Number(item.unique_ips),
    })) as ServicePerformanceData[];
  }
);

export const getErrorTrendsAction = action(
  getErrorTrendsSchema,
  async (parsedInput) => {
    const { startDate, endDate, granularity } = parsedInput;
    const supabase = getSupabaseAdminClient();

    const { data, error } = await (supabase as any).rpc("get_error_trends", {
      p_granularity: granularity,
      p_start_date: startDate === undefined ? null : startDate,
      p_end_date: endDate === undefined ? null : endDate,
    });

    if (error) {
      console.error(`Error fetching error trends (${granularity}):`, error);
      throw new AppError(
        error.message,
        appErrors.DATABASE_ERROR.code,
        appErrors.DATABASE_ERROR.statusCode
      );
    }

    return ((data as any[]) || []).map((item: any) => ({
      time_bucket: item.time_bucket,
      total_logs: Number(item.total_logs),
      error_count: Number(item.error_count),
      warn_count: Number(item.warn_count),
      fatal_count: Number(item.fatal_count),
      error_rate: Number(item.error_rate),
    })) as ErrorTrendsData[];
  }
);

export const getUserActivityPatternsAction = action(
  getUserActivityPatternsSchema,
  async (parsedInput) => {
    const { startDate, endDate, userId } = parsedInput;
    const supabase = getSupabaseAdminClient();

    const { data, error } = await (supabase as any).rpc(
      "get_user_activity_patterns",
      {
        p_start_date: startDate === undefined ? null : startDate,
        p_end_date: endDate === undefined ? null : endDate,
        p_user_id: userId === undefined ? null : userId,
      }
    );

    if (error) {
      console.error("Error fetching user activity patterns:", error);
      throw new AppError(
        error.message,
        appErrors.DATABASE_ERROR.code,
        appErrors.DATABASE_ERROR.statusCode
      );
    }

    return ((data as any[]) || []).map((item: any) => ({
      user_id: item.user_id,
      total_requests: Number(item.total_requests),
      unique_actions: Number(item.unique_actions),
      unique_services: Number(item.unique_services),
      avg_duration_ms: Number(item.avg_duration_ms || 0),
      error_count: Number(item.error_count),
      first_activity: item.first_activity,
      last_activity: item.last_activity,
      peak_hour: Number(item.peak_hour || 0),
    })) as UserActivityData[];
  }
);

export const getIpActivityDetailAction = action(
  getIpActivityDetailSchema,
  async (parsedInput) => {
    const { ipAddress, startDate, endDate, granularity } = parsedInput;
    const supabase = getSupabaseAdminClient();

    const { data, error } = await (supabase as any).rpc(
      "get_ip_activity_detail",
      {
        p_ip_address: ipAddress,
        p_start_date: startDate === undefined ? null : startDate,
        p_end_date: endDate === undefined ? null : endDate,
        p_granularity: granularity,
      }
    );

    if (error) {
      console.error(
        `Error fetching IP activity detail for ${ipAddress}:`,
        error
      );
      throw new AppError(
        error.message,
        appErrors.DATABASE_ERROR.code,
        appErrors.DATABASE_ERROR.statusCode
      );
    }

    return ((data as any[]) || []).map((item: any) => ({
      time_bucket: item.time_bucket,
      request_count: Number(item.request_count),
      unique_actions: Number(item.unique_actions),
      error_count: Number(item.error_count),
      avg_duration_ms: Number(item.avg_duration_ms || 0),
    })) as IpActivityDetailData[];
  }
);

// Enhanced logs action with better filtering
export const getFilteredLogsAction = action(
  getFilteredLogsSchema,
  async (parsedInput) => {
    const {
      page,
      limit,
      startDate,
      endDate,
      logLevel,
      serviceName,
      actionName,
      userId: filterUserId,
      ipAddress,
      errorCode,
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
    if (ipAddress) query = query.eq("ip_address", ipAddress);
    if (errorCode) query = query.ilike("error_code", `%${errorCode}%`);

    query = query.order(sortBy, { ascending: sortOrder === "asc" });
    query = query.range((page - 1) * limit, page * limit - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error("Error fetching filtered logs:", error);
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
        profiles: undefined,
      })) || [];

    return {
      logs: logsWithEmail as LogEntry[],
      totalCount: count || 0,
      totalPages: Math.ceil((count || 0) / limit),
      currentPage: page,
    };
  }
);

// Add new schema for TTS statistics logging
const logTtsStatisticsSchema = z.object({
  totalUtterances: z.number().int().min(0),
  totalDurationMs: z.number().min(0),
  successfulUtterances: z.number().int().min(0),
  failedUtterances: z.number().int().min(0),
  languageUsage: z.record(z.string(), z.number().int().min(0)),
  voiceUsage: z.record(z.string(), z.number().int().min(0)),
  averageUtteranceDuration: z.number().min(0),
  sessionStartTime: z.number(),
  sessionEndTime: z.number().optional(),
  sessionDurationMs: z.number().min(0).optional(),
  currentUrl: z.string().url().optional(),
  videoId: z.string().optional(), // YouTube video ID or movie ID
});

// Create a separate action client for TTS statistics (no admin required)
const publicAction = createSafeActionClient({
  async middleware() {
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

    return { userId: user.id, ipAddress: undefined };
  },
  handleReturnedServerError(e: Error) {
    if (e instanceof AppError) {
      return {
        serverError: e.message,
        errorCode: e.code,
      };
    }
    console.error("Unhandled error in TTS statistics action:", e);
    return {
      serverError: appErrors.UNEXPECTED_ERROR.message,
      errorCode: appErrors.UNEXPECTED_ERROR.code,
    };
  },
});

export const logTtsStatisticsAction = publicAction(
  logTtsStatisticsSchema,
  async (parsedInput, { userId, ipAddress }) => {
    const {
      totalUtterances,
      totalDurationMs,
      successfulUtterances,
      failedUtterances,
      languageUsage,
      voiceUsage,
      averageUtteranceDuration,
      sessionStartTime,
      sessionEndTime,
      sessionDurationMs,
      currentUrl,
      videoId,
    } = parsedInput;

    // Calculate derived metrics
    const actualSessionDuration =
      sessionDurationMs ||
      (sessionEndTime ? sessionEndTime - sessionStartTime : 0);
    const errorRate =
      totalUtterances > 0 ? (failedUtterances / totalUtterances) * 100 : 0;
    const successRate =
      totalUtterances > 0 ? (successfulUtterances / totalUtterances) * 100 : 0;

    // Prepare log entry for TTS statistics
    const logEntry: LogEntry = {
      log_level: "INFO",
      service_name: "tts",
      action_name: "local_tts_session_complete",
      user_id: userId,
      ip_address: ipAddress,
      duration_ms: actualSessionDuration,
      request_payload: {
        totalUtterances,
        totalDurationMs,
        successfulUtterances,
        failedUtterances,
        languageUsage,
        voiceUsage,
        averageUtteranceDuration,
        sessionStartTime,
        sessionEndTime,
        sessionDurationMs: actualSessionDuration,
        currentUrl,
        videoId,
      },
      response_payload: {
        errorRate: Math.round(errorRate * 100) / 100, // Round to 2 decimals
        successRate: Math.round(successRate * 100) / 100,
        utterancesPerMinute:
          actualSessionDuration > 0
            ? Math.round(
                (totalUtterances / (actualSessionDuration / 60000)) * 100
              ) / 100
            : 0,
        avgDurationPerUtterance: averageUtteranceDuration,
      },
      metadata: {
        isLocalTts: true,
        primaryLanguage:
          Object.keys(languageUsage).length > 0
            ? Object.keys(languageUsage).reduce(
                (a, b) => (languageUsage[a] > languageUsage[b] ? a : b),
                Object.keys(languageUsage)[0]
              )
            : undefined,
        primaryVoice:
          Object.keys(voiceUsage).length > 0
            ? Object.keys(voiceUsage).reduce(
                (a, b) => (voiceUsage[a] > voiceUsage[b] ? a : b),
                Object.keys(voiceUsage)[0]
              )
            : undefined,
        totalLanguages: Object.keys(languageUsage).length,
        totalVoices: Object.keys(voiceUsage).length,
      },
      tags: ["tts", "local", "dubbing", "statistics"],
    };

    // Use the logger to save the entry
    const logger = createLogger("tts");
    await logger.info("Local TTS session completed", logEntry);

    return {
      logged: true,
      sessionSummary: {
        totalUtterances,
        successRate,
        errorRate,
        sessionDurationMs: actualSessionDuration,
        primaryLanguage: (logEntry.metadata as any)?.primaryLanguage,
        primaryVoice: (logEntry.metadata as any)?.primaryVoice,
      },
    };
  }
);
