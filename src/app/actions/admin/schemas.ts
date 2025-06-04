import { z } from "zod";
import type { LogLevel } from "@/lib/logger";

const logLevelsTuple: readonly [LogLevel, ...LogLevel[]] = [
  "DEBUG",
  "INFO",
  "WARN",
  "ERROR",
  "FATAL",
];

export const getLogsSchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(25),
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate: z.string().datetime({ offset: true }).optional(),
  logLevel: z.enum(logLevelsTuple).optional(),
  serviceName: z.string().optional(),
  actionName: z.string().optional(),
  userId: z.string().uuid().optional(),
  sortBy: z
    .enum(["created_at", "log_level", "service_name"])
    .default("created_at"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const getLogStatsSchema = z.object({
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate: z.string().datetime({ offset: true }).optional(),
  groupBy: z
    .enum(["log_level", "service_name", "action_name", "error_code"])
    .default("log_level"),
});

export const getLogByIdSchema = z.object({
  id: z.string().uuid(),
});

// Interface for log statistics
export interface LogStat {
  group_key: string;
  item_count: number;
}

// Schema for time-based log statistics action
export const getTimeBasedLogStatsSchema = z.object({
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate: z.string().datetime({ offset: true }).optional(),
  granularity: z.enum(["day", "month", "year"]),
});

// Interface for data returned by getTimeBasedLogStatsAction
export interface TimeSeriesStatData {
  date: string; // ISO string from date_trunc, e.g., "2023-10-26T00:00:00.000Z"
  count: number;
}

// Schema for unique IP activity action
export const getUniqueIpActivitySchema = z.object({
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate: z.string().datetime({ offset: true }).optional(),
  granularity: z.enum(["day", "month", "year"]),
});

// Interface for data returned by getUniqueIpActivityAction
export interface UniqueIpActivityData {
  date: string; // ISO string from date_trunc
  unique_ip_count: number;
}

// New enhanced analytics schemas and interfaces

// Request Volume Metrics
export const getRequestVolumeSchema = z.object({
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate: z.string().datetime({ offset: true }).optional(),
  granularity: z.enum(["hour", "day", "week", "month"]),
});

export interface RequestVolumeData {
  time_bucket: string;
  total_requests: number;
  unique_users: number;
  unique_ips: number;
  error_requests: number;
  avg_duration_ms: number;
}

// Top Active IPs
export const getTopActiveIpsSchema = z.object({
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate: z.string().datetime({ offset: true }).optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export interface TopActiveIpData {
  ip_address: string;
  total_requests: number;
  unique_actions: number;
  unique_services: number;
  error_count: number;
  error_rate: number;
  avg_duration_ms: number;
  first_seen: string;
  last_seen: string;
}

// Service Performance Metrics
export const getServicePerformanceSchema = z.object({
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate: z.string().datetime({ offset: true }).optional(),
});

export interface ServicePerformanceData {
  service_name: string;
  total_requests: number;
  avg_duration_ms: number;
  p95_duration_ms: number;
  error_count: number;
  error_rate: number;
  unique_users: number;
  unique_ips: number;
}

// Error Trends
export const getErrorTrendsSchema = z.object({
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate: z.string().datetime({ offset: true }).optional(),
  granularity: z.enum(["hour", "day", "week"]),
});

export interface ErrorTrendsData {
  time_bucket: string;
  total_logs: number;
  error_count: number;
  warn_count: number;
  fatal_count: number;
  error_rate: number;
}

// User Activity Patterns
export const getUserActivityPatternsSchema = z.object({
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate: z.string().datetime({ offset: true }).optional(),
  userId: z.string().uuid().optional(),
});

export interface UserActivityData {
  user_id: string;
  total_requests: number;
  unique_actions: number;
  unique_services: number;
  avg_duration_ms: number;
  error_count: number;
  first_activity: string;
  last_activity: string;
  peak_hour: number;
}

// IP Activity Detail (for drill-down)
export const getIpActivityDetailSchema = z.object({
  ipAddress: z.string().ip(),
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate: z.string().datetime({ offset: true }).optional(),
  granularity: z.enum(["hour", "day"]).default("hour"),
});

export interface IpActivityDetailData {
  time_bucket: string;
  request_count: number;
  unique_actions: number;
  error_count: number;
  avg_duration_ms: number;
}

// Enhanced log filtering with drill-down support
export const getFilteredLogsSchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(25),
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate: z.string().datetime({ offset: true }).optional(),
  logLevel: z.enum(logLevelsTuple).optional(),
  serviceName: z.string().optional(),
  actionName: z.string().optional(),
  userId: z.string().uuid().optional(),
  ipAddress: z.string().ip().optional(),
  errorCode: z.string().optional(),
  sortBy: z
    .enum(["created_at", "log_level", "service_name", "duration_ms"])
    .default("created_at"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

// Chart interaction schema for drill-down functionality
export const getChartDrillDownSchema = z.object({
  chartType: z.enum(["service", "log_level", "error_code", "ip_address"]),
  filterValue: z.string(),
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate: z.string().datetime({ offset: true }).optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(25),
});

// Real-time metrics schema
export const getRealTimeMetricsSchema = z.object({
  timeWindow: z.enum(["5m", "15m", "1h", "24h"]).default("1h"),
});

export interface RealTimeMetricsData {
  current_active_users: number;
  current_requests_per_minute: number;
  current_error_rate: number;
  avg_response_time: number;
  peak_concurrent_users: number;
  total_requests_today: number;
}
