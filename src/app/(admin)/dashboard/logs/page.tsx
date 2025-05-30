"use client";

import { useEffect, useState, useCallback } from "react";
import {
  useQueryState,
  parseAsInteger,
  parseAsString,
  parseAsIsoDateTime,
} from "nuqs";
import {
  getLogsAction,
  getLogStatsAction,
  getTimeBasedLogStatsAction,
} from "@/app/actions/admin/logs";
import type {
  PaginatedLogsResponse as AdminPaginatedLogsResponse,
  LogStat as AdminLogStat,
  TimeSeriesStatData,
} from "@/app/actions/admin/logs";
import type { LogEntry, LogLevel } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { subDays, subMonths, startOfDay, endOfDay, format } from "date-fns";

const LOG_LEVELS: LogLevel[] = ["DEBUG", "INFO", "WARN", "ERROR", "FATAL"];

const PIE_CHART_COLORS = [
  "#0088FE",
  "#00C49F",
  "#FFBB28",
  "#FF8042",
  "#8884D8",
];
const BAR_CHART_FILL_COLOR = "hsl(var(--primary))";
const LINE_CHART_STROKE_COLOR = "hsl(var(--primary))";

interface TimeSeriesStat {
  date: string;
  count: number;
}

export default function AdminLogsPage() {
  const [logsData, setLogsData] = useState<AdminPaginatedLogsResponse | null>(
    null
  );
  const [logLevelChartData, setLogLevelChartData] = useState<
    AdminLogStat[] | null
  >(null);
  const [serviceNameChartData, setServiceNameChartData] = useState<
    AdminLogStat[] | null
  >(null);
  const [errorCodeChartData, setErrorCodeChartData] = useState<
    AdminLogStat[] | null
  >(null);
  const [dailyLogCounts, setDailyLogCounts] = useState<TimeSeriesStat[] | null>(
    null
  );
  const [monthlyLogCounts, setMonthlyLogCounts] = useState<
    TimeSeriesStat[] | null
  >(null);

  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [isLoadingCharts, setIsLoadingCharts] = useState(false);
  const [isLoadingTimeCharts, setIsLoadingTimeCharts] = useState(false);
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [activeDateRange, setActiveDateRange] = useState<string | null>(null);

  const [page, setPage] = useQueryState("page", parseAsInteger.withDefault(1));
  const [limit, setLimit] = useQueryState(
    "limit",
    parseAsInteger.withDefault(10)
  );
  const [logLevelFilter, setLogLevelFilter] = useQueryState(
    "logLevel",
    parseAsString.withOptions({ shallow: false }).withDefault("")
  );
  const [serviceNameFilter, setServiceNameFilter] = useQueryState(
    "service",
    parseAsString.withOptions({ shallow: false }).withDefault("")
  );
  const [actionNameFilter, setActionNameFilter] = useQueryState(
    "action",
    parseAsString.withOptions({ shallow: false }).withDefault("")
  );
  const [userIdFilter, setUserIdFilter] = useQueryState(
    "userId",
    parseAsString.withOptions({ shallow: false }).withDefault("")
  );
  const [startDateFilter, setStartDateFilter] = useQueryState(
    "startDate",
    parseAsIsoDateTime.withOptions({ shallow: false })
  );
  const [endDateFilter, setEndDateFilter] = useQueryState(
    "endDate",
    parseAsIsoDateTime.withOptions({ shallow: false })
  );

  const currentLogLevelFilterForAction =
    logLevelFilter === "" ? undefined : (logLevelFilter as LogLevel);

  const fetchLogs = useCallback(async () => {
    setIsLoadingLogs(true);
    const result = await getLogsAction({
      page,
      limit,
      logLevel: currentLogLevelFilterForAction,
      serviceName: serviceNameFilter || undefined,
      actionName: actionNameFilter || undefined,
      userId: userIdFilter || undefined,
      startDate: startDateFilter?.toISOString(),
      endDate: endDateFilter?.toISOString(),
    });

    if (result.data) {
      setLogsData(result.data);
    } else {
      setLogsData(null);
      if (result.serverError) {
        toast.error(result.serverError || "Failed to fetch logs");
      } else if (result.validationError) {
        const errorMessages = Object.values(result.validationError)
          .flat()
          .join(", ");
        toast.error(`Validation Error: ${errorMessages}`);
        console.error("Log validation error:", result.validationError);
      } else {
        toast.error("An unexpected error occurred while fetching logs.");
      }
    }
    setIsLoadingLogs(false);
  }, [
    page,
    limit,
    currentLogLevelFilterForAction,
    serviceNameFilter,
    actionNameFilter,
    userIdFilter,
    startDateFilter,
    endDateFilter,
  ]);

  const fetchAllChartData = useCallback(async () => {
    setIsLoadingCharts(true);
    try {
      const [levels, services, errors] = await Promise.all([
        getLogStatsAction({
          groupBy: "log_level",
          startDate: startDateFilter?.toISOString(),
          endDate: endDateFilter?.toISOString(),
        }),
        getLogStatsAction({
          groupBy: "service_name",
          startDate: startDateFilter?.toISOString(),
          endDate: endDateFilter?.toISOString(),
        }),
        getLogStatsAction({
          groupBy: "error_code",
          startDate: startDateFilter?.toISOString(),
          endDate: endDateFilter?.toISOString(),
        }),
      ]);

      if (levels.data) setLogLevelChartData(levels.data);
      else if (levels.serverError)
        toast.error(`Chart Error (Levels): ${levels.serverError}`);

      if (services.data) setServiceNameChartData(services.data);
      else if (services.serverError)
        toast.error(`Chart Error (Services): ${services.serverError}`);

      if (errors.data)
        setErrorCodeChartData(errors.data.filter((e) => e.group_key));
      else if (errors.serverError)
        toast.error(`Chart Error (Error Codes): ${errors.serverError}`);
    } catch (error) {
      toast.error("Failed to load chart data.");
      console.error("Chart data fetch error:", error);
    }
    setIsLoadingCharts(false);
  }, [startDateFilter, endDateFilter]);

  const fetchTimeBasedLogCounts = useCallback(async () => {
    if (!startDateFilter || !endDateFilter) {
      setDailyLogCounts(null);
      setMonthlyLogCounts(null);
      return;
    }
    setIsLoadingTimeCharts(true);
    setDailyLogCounts(null);
    setMonthlyLogCounts(null);

    try {
      const [dailyResult, monthlyResult] = await Promise.all([
        getTimeBasedLogStatsAction({
          granularity: "day",
          startDate: startDateFilter.toISOString(),
          endDate: endDateFilter.toISOString(),
        }),
        getTimeBasedLogStatsAction({
          granularity: "month",
          startDate: startDateFilter.toISOString(),
          endDate: endDateFilter.toISOString(),
        }),
      ]);

      if (dailyResult.data) {
        setDailyLogCounts(
          Array.isArray(dailyResult.data) ? [...dailyResult.data] : null
        );
      } else if (dailyResult.serverError) {
        toast.error(`Chart Error (Daily Logs): ${dailyResult.serverError}`);
        setDailyLogCounts(null);
      } else if (dailyResult.validationError) {
        toast.error(
          `Validation Error (Daily Logs): ${Object.values(
            dailyResult.validationError
          )
            .flat()
            .join(", ")}`
        );
        setDailyLogCounts(null);
      } else {
        setDailyLogCounts(null);
      }

      if (monthlyResult.data) {
        setMonthlyLogCounts(
          Array.isArray(monthlyResult.data) ? [...monthlyResult.data] : null
        );
      } else if (monthlyResult.serverError) {
        toast.error(`Chart Error (Monthly Logs): ${monthlyResult.serverError}`);
        setMonthlyLogCounts(null);
      } else if (monthlyResult.validationError) {
        toast.error(
          `Validation Error (Monthly Logs): ${Object.values(
            monthlyResult.validationError
          )
            .flat()
            .join(", ")}`
        );
        setMonthlyLogCounts(null);
      } else {
        setMonthlyLogCounts(null);
      }
    } catch (error) {
      toast.error("Failed to load time-based log counts.");
      console.error("Time-based log counts fetch error:", error);
    }

    setIsLoadingTimeCharts(false);
  }, [startDateFilter, endDateFilter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    fetchAllChartData();
  }, [fetchAllChartData]);

  useEffect(() => {
    fetchTimeBasedLogCounts();
  }, [fetchTimeBasedLogCounts]);

  const handleSetDateRange = (
    rangeKey: string,
    days?: number,
    months?: number
  ) => {
    const todayEnd = endOfDay(new Date());
    let start;

    if (rangeKey === "lastWeek") {
      start = startOfDay(subDays(todayEnd, 6));
    } else if (rangeKey === "lastMonth") {
      start = startOfDay(subMonths(todayEnd, 1));
    } else if (rangeKey === "last3Months") {
      start = startOfDay(subMonths(todayEnd, 3));
    } else if (rangeKey === "last6Months") {
      start = startOfDay(subMonths(todayEnd, 6));
    } else {
      setStartDateFilter(null);
      setEndDateFilter(null);
      setActiveDateRange(null);
      return;
    }
    setStartDateFilter(start);
    setEndDateFilter(todayEnd);
    setActiveDateRange(rangeKey);
  };

  const handleApplyAllFilters = () => {
    setPage(1).then(() => {
      fetchLogs();
      fetchAllChartData();
      fetchTimeBasedLogCounts();
    });
  };

  const handleViewDetails = (log: LogEntry) => {
    setSelectedLog(log);
    setIsDetailModalOpen(true);
  };

  const handleCloseDetailsModal = () => {
    setSelectedLog(null);
    setIsDetailModalOpen(false);
  };

  const dateRangeButtons = [
    { key: "lastWeek", label: "Last 7 Days" },
    { key: "lastMonth", label: "Last Month" },
    { key: "last3Months", label: "Last 3 Months" },
    { key: "last6Months", label: "Last 6 Months" },
  ];

  return (
    <div className="space-y-8 p-4 md:p-6 lg:p-8 bg-background text-foreground">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          Application Logs Dashboard
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          {dateRangeButtons.map((btn) => (
            <Button
              key={btn.key}
              variant={activeDateRange === btn.key ? "default" : "outline"}
              onClick={() => handleSetDateRange(btn.key)}
              size="sm"
            >
              {btn.label}
            </Button>
          ))}
        </div>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>
            Refine logs and statistics view. Select a quick range or set custom
            dates.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 items-end">
            <div className="space-y-1">
              <label
                htmlFor="startDate"
                className="text-sm font-medium text-muted-foreground"
              >
                Start Date
              </label>
              <Input
                id="startDate"
                type="datetime-local"
                value={
                  startDateFilter
                    ? format(startDateFilter, "yyyy-MM-dd'T'HH:mm")
                    : ""
                }
                onChange={(e) => {
                  setStartDateFilter(
                    e.target.value ? new Date(e.target.value) : null
                  );
                  setActiveDateRange(null);
                }}
                className="bg-input border-border"
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="endDate"
                className="text-sm font-medium text-muted-foreground"
              >
                End Date
              </label>
              <Input
                id="endDate"
                type="datetime-local"
                value={
                  endDateFilter
                    ? format(endDateFilter, "yyyy-MM-dd'T'HH:mm")
                    : ""
                }
                onChange={(e) => {
                  setEndDateFilter(
                    e.target.value ? new Date(e.target.value) : null
                  );
                  setActiveDateRange(null);
                }}
                className="bg-input border-border"
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="logLevel"
                className="text-sm font-medium text-muted-foreground"
              >
                Log Level
              </label>
              <Select
                value={logLevelFilter || ""}
                onValueChange={(val) => {
                  if (val === "__ALL_LEVELS__") {
                    setLogLevelFilter(null);
                  } else {
                    setLogLevelFilter(val as LogLevel);
                  }
                }}
              >
                <SelectTrigger id="logLevel" className="bg-input border-border">
                  <SelectValue placeholder="Log Level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__ALL_LEVELS__">All Levels</SelectItem>
                  {LOG_LEVELS.map((level) => (
                    <SelectItem key={level} value={level}>
                      {level}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label
                htmlFor="serviceName"
                className="text-sm font-medium text-muted-foreground"
              >
                Service Name
              </label>
              <Input
                id="serviceName"
                placeholder="Service Name"
                value={serviceNameFilter}
                onChange={(e) => setServiceNameFilter(e.target.value)}
                className="bg-input border-border"
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="actionName"
                className="text-sm font-medium text-muted-foreground"
              >
                Action Name
              </label>
              <Input
                id="actionName"
                placeholder="Action Name"
                value={actionNameFilter}
                onChange={(e) => setActionNameFilter(e.target.value)}
                className="bg-input border-border"
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="userId"
                className="text-sm font-medium text-muted-foreground"
              >
                User ID
              </label>
              <Input
                id="userId"
                placeholder="User ID (UUID)"
                value={userIdFilter}
                onChange={(e) => setUserIdFilter(e.target.value)}
                className="bg-input border-border"
              />
            </div>
          </div>
          <Button
            onClick={handleApplyAllFilters}
            size="lg"
            className="w-full sm:w-auto"
          >
            Apply Filters
          </Button>
        </CardContent>
      </Card>

      <section className="space-y-6">
        <h2 className="text-2xl font-semibold tracking-tight">
          Activity Overview
        </h2>
        {(isLoadingCharts || isLoadingTimeCharts) && (
          <p className="text-center text-muted-foreground py-8">
            Loading charts...
          </p>
        )}

        {!isLoadingTimeCharts &&
          dailyLogCounts &&
          dailyLogCounts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Daily Log Activity</CardTitle>
                <CardDescription>
                  Total logs per day for the selected period.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={350}>
                  <LineChart
                    data={dailyLogCounts}
                    margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="hsl(var(--border))"
                    />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(tick) => format(new Date(tick), "MMM dd")}
                      stroke="hsl(var(--muted-foreground))"
                    />
                    <YAxis stroke="hsl(var(--muted-foreground))" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--popover))",
                        borderColor: "hsl(var(--border))",
                      }}
                      labelStyle={{ color: "hsl(var(--popover-foreground))" }}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="count"
                      name="Daily Logs"
                      stroke={LINE_CHART_STROKE_COLOR}
                      strokeWidth={2}
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        {!isLoadingTimeCharts &&
          (!dailyLogCounts || dailyLogCounts.length === 0) && (
            <Card className="flex items-center justify-center h-48">
              <p className="text-muted-foreground">
                No daily log data for selected period.
              </p>
            </Card>
          )}

        {!isLoadingTimeCharts &&
          monthlyLogCounts &&
          monthlyLogCounts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Monthly Log Overview</CardTitle>
                <CardDescription>
                  Total logs per month for the selected period.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart
                    data={monthlyLogCounts}
                    margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="hsl(var(--border))"
                    />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(tick) =>
                        format(new Date(tick + "-01"), "MMM yyyy")
                      }
                      stroke="hsl(var(--muted-foreground))"
                    />
                    <YAxis stroke="hsl(var(--muted-foreground))" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--popover))",
                        borderColor: "hsl(var(--border))",
                      }}
                      labelStyle={{ color: "hsl(var(--popover-foreground))" }}
                    />
                    <Legend />
                    <Bar
                      dataKey="count"
                      name="Monthly Logs"
                      fill={BAR_CHART_FILL_COLOR}
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

        {!isLoadingCharts && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="col-span-1 lg:col-span-1">
              <CardHeader>
                <CardTitle>Logs by Level</CardTitle>
                <CardDescription>
                  Distribution of log severities.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {logLevelChartData && logLevelChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={logLevelChartData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        outerRadius={100}
                        fill="#8884d8"
                        dataKey="item_count"
                        nameKey="group_key"
                        label={({ name, percent }) =>
                          `${name} (${(percent * 100).toFixed(0)}%)`
                        }
                      >
                        {logLevelChartData.map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={
                              PIE_CHART_COLORS[index % PIE_CHART_COLORS.length]
                            }
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--popover))",
                          borderColor: "hsl(var(--border))",
                          color: "hsl(var(--popover-foreground))",
                        }}
                        itemStyle={{ color: "hsl(var(--popover-foreground))" }}
                        labelStyle={{ color: "hsl(var(--popover-foreground))" }}
                      />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-muted-foreground text-sm text-center py-10">
                    No data for log levels.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="col-span-1 lg:col-span-2">
              <CardHeader>
                <CardTitle>Logs by Service</CardTitle>
                <CardDescription>Number of logs per service.</CardDescription>
              </CardHeader>
              <CardContent>
                {serviceNameChartData && serviceNameChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart
                      data={serviceNameChartData}
                      layout="vertical"
                      margin={{ left: 30, right: 30, top: 5, bottom: 5 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="hsl(var(--border))"
                      />
                      <XAxis
                        type="number"
                        stroke="hsl(var(--muted-foreground))"
                      />
                      <YAxis
                        dataKey="group_key"
                        type="category"
                        width={150}
                        interval={0}
                        stroke="hsl(var(--muted-foreground))"
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--popover))",
                          borderColor: "hsl(var(--border))",
                        }}
                        itemStyle={{ color: "hsl(var(--popover-foreground))" }}
                        labelStyle={{ color: "hsl(var(--popover-foreground))" }}
                      />
                      <Legend />
                      <Bar
                        dataKey="item_count"
                        name="Log Count"
                        fill={BAR_CHART_FILL_COLOR}
                        radius={[0, 4, 4, 0]}
                        barSize={20}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-muted-foreground text-sm text-center py-10">
                    No data for service names.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        )}
        {!isLoadingCharts &&
          errorCodeChartData &&
          errorCodeChartData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Top Error Codes</CardTitle>
                <CardDescription>
                  Frequency of specific error codes.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart
                    data={errorCodeChartData.slice(0, 10)}
                    margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="hsl(var(--border))"
                    />
                    <XAxis
                      dataKey="group_key"
                      stroke="hsl(var(--muted-foreground))"
                    />
                    <YAxis stroke="hsl(var(--muted-foreground))" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--popover))",
                        borderColor: "hsl(var(--border))",
                      }}
                      labelStyle={{ color: "hsl(var(--popover-foreground))" }}
                    />
                    <Legend />
                    <Bar
                      dataKey="item_count"
                      name="Error Count"
                      fill="hsl(var(--destructive))"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
      </section>

      <section>
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center">
              <div>
                <CardTitle>Detailed Logs</CardTitle>
                <CardDescription>
                  Paginated view of application logs. Page: {page}, Limit:{" "}
                  {limit}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoadingLogs && (
              <p className="text-center text-muted-foreground py-10">
                Loading logs...
              </p>
            )}
            {!isLoadingLogs && logsData && logsData.logs.length > 0 && (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[150px]">Timestamp</TableHead>
                      <TableHead>Level</TableHead>
                      <TableHead>Service</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead className="w-[30%]">Message</TableHead>
                      <TableHead>User ID</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logsData.logs.map((log: LogEntry) => (
                      <TableRow key={log.id}>
                        <TableCell className="font-medium">
                          {log.created_at
                            ? new Date(log.created_at).toLocaleString()
                            : "N/A"}
                        </TableCell>
                        <TableCell>
                          <span
                            className={`px-2 py-1 text-xs font-semibold rounded-full ${
                              log.log_level === "ERROR" ||
                              log.log_level === "FATAL"
                                ? "bg-red-500/20 text-red-400"
                                : log.log_level === "WARN"
                                ? "bg-yellow-500/20 text-yellow-400"
                                : log.log_level === "INFO"
                                ? "bg-blue-500/20 text-blue-400"
                                : "bg-gray-500/20 text-gray-400"
                            }`}
                          >
                            {log.log_level}
                          </span>
                        </TableCell>
                        <TableCell>{log.service_name || "-"}</TableCell>
                        <TableCell>{log.action_name || "-"}</TableCell>
                        <TableCell
                          className="max-w-xs truncate text-muted-foreground"
                          title={
                            log.error_message ||
                            (log.metadata
                              ? JSON.stringify(log.metadata, null, 2)
                              : "No additional details")
                          }
                        >
                          {log.error_message ||
                            (log.metadata
                              ? `Metadata: ${Object.keys(log.metadata).join(
                                  ", "
                                )}`
                              : "No error message")}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {log.user_email || log.user_id || "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleViewDetails(log)}
                          >
                            Details
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
                  <p className="text-sm text-muted-foreground">
                    Total Logs: {logsData.totalCount}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1 || isLoadingLogs}
                    >
                      Previous
                    </Button>
                    <span className="text-sm p-2 text-muted-foreground">
                      Page {logsData.currentPage} of {logsData.totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setPage((p) => Math.min(logsData.totalPages, p + 1))
                      }
                      disabled={page >= logsData.totalPages || isLoadingLogs}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </>
            )}
            {!isLoadingLogs && (!logsData || logsData.logs.length === 0) && (
              <div className="text-center py-10">
                <FileTextIcon className="mx-auto h-12 w-12 text-muted-foreground" />
                <h3 className="mt-2 text-sm font-medium text-foreground">
                  No logs found
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Try adjusting your filters or selected date range.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {selectedLog && (
        <Dialog
          open={isDetailModalOpen}
          onOpenChange={(open) => {
            if (!open) {
              handleCloseDetailsModal();
            }
          }}
        >
          <DialogContent className="max-w-3xl max-h-[90vh] bg-card">
            <DialogHeader className="border-b border-border pb-3">
              <DialogTitle className="text-xl">Log Details</DialogTitle>
              <DialogClose asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-3 right-3 h-7 w-7"
                >
                  {/* <CrossIcon className="h-4 w-4" /> */}
                </Button>
              </DialogClose>
            </DialogHeader>
            <div className="p-6 text-sm overflow-y-auto max-h-[calc(90vh-140px)]">
              <pre className="whitespace-pre-wrap break-all bg-muted/50 p-4 rounded-md">
                {JSON.stringify(selectedLog, null, 2)}
              </pre>
            </div>
            <DialogFooter className="sm:justify-end px-6 py-4 border-t border-border">
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCloseDetailsModal}
                >
                  Close
                </Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function FileTextIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" x2="8" y1="13" y2="13" />
      <line x1="16" x2="8" y1="17" y2="17" />
      <line x1="10" x2="8" y1="9" y2="9" />
    </svg>
  );
}
