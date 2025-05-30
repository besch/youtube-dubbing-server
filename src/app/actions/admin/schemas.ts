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
