"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  useQueryState,
  parseAsInteger,
  parseAsString,
  parseAsIsoDateTime,
} from "nuqs";
import {
  getLogsAction,
  getLogStatsAction,
  getRequestVolumeAction,
  getTopActiveIpsAction,
  getServicePerformanceAction,
  getErrorTrendsAction,
  getUserActivityPatternsAction,
  getIpActivityDetailAction,
  getFilteredLogsAction,
} from "@/app/actions/admin/logs";
import type {
  PaginatedLogsResponse as AdminPaginatedLogsResponse,
  LogStat as AdminLogStat,
  RequestVolumeData,
  TopActiveIpData,
  ServicePerformanceData,
  ErrorTrendsData,
  UserActivityData,
  IpActivityDetailData,
} from "@/app/actions/admin/logs";
import type { LogEntry, LogLevel } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
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
  AreaChart,
  Area,
  ComposedChart,
  ReferenceLine,
} from "recharts";
import {
  subDays,
  subMonths,
  startOfDay,
  endOfDay,
  format,
  subHours,
  formatDistanceToNow,
} from "date-fns";
import {
  Activity,
  AlertTriangle,
  Clock,
  Database,
  Globe,
  TrendingUp,
  Users,
  Zap,
  Eye,
  Filter,
  Download,
  RefreshCw,
  Search,
} from "lucide-react";

const LOG_LEVELS: LogLevel[] = ["DEBUG", "INFO", "WARN", "ERROR", "FATAL"];

// Modern color palette
const COLORS = {
  primary: "hsl(217, 91%, 60%)",
  secondary: "hsl(270, 95%, 75%)",
  success: "hsl(120, 100%, 40%)",
  warning: "hsl(43, 96%, 56%)",
  danger: "hsl(0, 84%, 60%)",
  info: "hsl(200, 100%, 70%)",
  muted: "hsl(215, 20%, 65%)",
  background: "hsl(222, 84%, 5%)",
  accent: "hsl(280, 100%, 70%)",
};

const PIE_CHART_COLORS = [
  COLORS.primary,
  COLORS.success,
  COLORS.warning,
  COLORS.danger,
  COLORS.secondary,
  COLORS.info,
  COLORS.accent,
  COLORS.muted,
];

const LOG_LEVEL_COLORS = {
  DEBUG: COLORS.muted,
  INFO: COLORS.info,
  WARN: COLORS.warning,
  ERROR: COLORS.danger,
  FATAL: COLORS.danger,
};

interface MetricCard {
  title: string;
  value: string | number;
  icon: React.ElementType;
  trend?: string;
  color: string;
}

interface DrillDownState {
  isOpen: boolean;
  type: "ip" | "service" | "user" | null;
  value: string;
  data: any[];
}

export default function AdminLogsPage() {
  // Data states
  const [logsData, setLogsData] = useState<AdminPaginatedLogsResponse | null>(
    null
  );
  const [requestVolumeData, setRequestVolumeData] = useState<
    RequestVolumeData[] | null
  >(null);
  const [topActiveIps, setTopActiveIps] = useState<TopActiveIpData[] | null>(
    null
  );
  const [servicePerformance, setServicePerformance] = useState<
    ServicePerformanceData[] | null
  >(null);
  const [errorTrends, setErrorTrends] = useState<ErrorTrendsData[] | null>(
    null
  );
  const [userActivity, setUserActivity] = useState<UserActivityData[] | null>(
    null
  );
  const [logLevelStats, setLogLevelStats] = useState<AdminLogStat[] | null>(
    null
  );

  // Loading states
  const [isLoadingOverview, setIsLoadingOverview] = useState(false);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [isLoadingCharts, setIsLoadingCharts] = useState(false);

  // UI states
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [drillDown, setDrillDown] = useState<DrillDownState>({
    isOpen: false,
    type: null,
    value: "",
    data: [],
  });
  const [activeDateRange, setActiveDateRange] = useState<string>("last24h");
  const [granularity, setGranularity] = useState<"hour" | "day" | "week">(
    "hour"
  );

  // Query state
  const [page, setPage] = useQueryState("page", parseAsInteger.withDefault(1));
  const [limit, setLimit] = useQueryState(
    "limit",
    parseAsInteger.withDefault(20)
  );
  const [logLevelFilter, setLogLevelFilter] = useQueryState(
    "logLevel",
    parseAsString
  );
  const [serviceNameFilter, setServiceNameFilter] = useQueryState(
    "service",
    parseAsString
  );
  const [actionNameFilter, setActionNameFilter] = useQueryState(
    "action",
    parseAsString
  );
  const [userIdFilter, setUserIdFilter] = useQueryState(
    "userId",
    parseAsString
  );
  const [ipAddressFilter, setIpAddressFilter] = useQueryState(
    "ip",
    parseAsString
  );
  const [startDateFilter, setStartDateFilter] = useQueryState(
    "startDate",
    parseAsIsoDateTime
  );
  const [endDateFilter, setEndDateFilter] = useQueryState(
    "endDate",
    parseAsIsoDateTime
  );

  // Date range management
  const handleSetDateRange = useCallback(
    (rangeKey: string) => {
      const now = new Date();
      let start: Date;
      let end = now;
      let newGranularity: "hour" | "day" | "week" = "hour";

      switch (rangeKey) {
        case "last24h":
          start = subHours(now, 24);
          newGranularity = "hour";
          break;
        case "last7d":
          start = subDays(now, 7);
          newGranularity = "day";
          break;
        case "last30d":
          start = subDays(now, 30);
          newGranularity = "day";
          break;
        case "last3m":
          start = subMonths(now, 3);
          newGranularity = "week";
          break;
        default:
          return;
      }

      setStartDateFilter(start);
      setEndDateFilter(end);
      setActiveDateRange(rangeKey);
      setGranularity(newGranularity);
    },
    [setStartDateFilter, setEndDateFilter]
  );

  // Initialize with last 24 hours
  useEffect(() => {
    if (!startDateFilter || !endDateFilter) {
      handleSetDateRange("last24h");
    }
  }, [handleSetDateRange, startDateFilter, endDateFilter]);

  // Fetch overview data
  const fetchOverviewData = useCallback(async () => {
    if (!startDateFilter || !endDateFilter) return;

    setIsLoadingOverview(true);
    try {
      const [requestVolume, topIps, servicePerf, errors, logStats] =
        await Promise.all([
          getRequestVolumeAction({
            startDate: startDateFilter.toISOString(),
            endDate: endDateFilter.toISOString(),
            granularity,
          }),
          getTopActiveIpsAction({
            startDate: startDateFilter.toISOString(),
            endDate: endDateFilter.toISOString(),
            limit: 10,
          }),
          getServicePerformanceAction({
            startDate: startDateFilter.toISOString(),
            endDate: endDateFilter.toISOString(),
          }),
          getErrorTrendsAction({
            startDate: startDateFilter.toISOString(),
            endDate: endDateFilter.toISOString(),
            granularity,
          }),
          getLogStatsAction({
            startDate: startDateFilter.toISOString(),
            endDate: endDateFilter.toISOString(),
            groupBy: "log_level",
          }),
        ]);

      if (requestVolume.data) setRequestVolumeData(requestVolume.data);
      if (topIps.data) setTopActiveIps(topIps.data);
      if (servicePerf.data) setServicePerformance(servicePerf.data);
      if (errors.data) setErrorTrends(errors.data);
      if (logStats.data) setLogLevelStats(logStats.data);
    } catch (error) {
      toast.error("Failed to load overview data");
      console.error("Overview data fetch error:", error);
    }
    setIsLoadingOverview(false);
  }, [startDateFilter, endDateFilter, granularity]);

  // Fetch logs
  const fetchLogs = useCallback(async () => {
    setIsLoadingLogs(true);
    try {
      const result = await getFilteredLogsAction({
        page,
        limit,
        startDate: startDateFilter?.toISOString(),
        endDate: endDateFilter?.toISOString(),
        logLevel: logLevelFilter as LogLevel,
        serviceName: serviceNameFilter || undefined,
        actionName: actionNameFilter || undefined,
        userId: userIdFilter || undefined,
        ipAddress: ipAddressFilter || undefined,
      });

      if (result.data) {
        setLogsData(result.data);
      } else {
        toast.error("Failed to fetch logs");
      }
    } catch (error) {
      toast.error("Failed to fetch logs");
      console.error("Logs fetch error:", error);
    }
    setIsLoadingLogs(false);
  }, [
    page,
    limit,
    startDateFilter,
    endDateFilter,
    logLevelFilter,
    serviceNameFilter,
    actionNameFilter,
    userIdFilter,
    ipAddressFilter,
  ]);

  // Effects
  useEffect(() => {
    fetchOverviewData();
  }, [fetchOverviewData]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Calculate metrics
  const metrics = useMemo<MetricCard[]>(() => {
    if (!requestVolumeData || !topActiveIps || !errorTrends) return [];

    const totalRequests = requestVolumeData.reduce(
      (sum, d) => sum + d.total_requests,
      0
    );
    const totalErrors = requestVolumeData.reduce(
      (sum, d) => sum + d.error_requests,
      0
    );
    const errorRate =
      totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;
    const avgResponseTime =
      requestVolumeData.reduce((sum, d) => sum + (d.avg_duration_ms || 0), 0) /
      (requestVolumeData.length || 1);
    const uniqueUsers = Math.max(
      ...(requestVolumeData.map((d) => d.unique_users) || [0])
    );
    const uniqueIPs = Math.max(
      ...(requestVolumeData.map((d) => d.unique_ips) || [0])
    );

    return [
      {
        title: "Total Requests",
        value: totalRequests.toLocaleString(),
        icon: Activity,
        color: COLORS.primary,
        trend: "+12%",
      },
      {
        title: "Error Rate",
        value: `${errorRate.toFixed(2)}%`,
        icon: AlertTriangle,
        color: errorRate > 5 ? COLORS.danger : COLORS.success,
        trend: errorRate > 5 ? "+2.1%" : "-1.3%",
      },
      {
        title: "Avg Response Time",
        value: `${avgResponseTime.toFixed(0)}ms`,
        icon: Clock,
        color: avgResponseTime > 1000 ? COLORS.warning : COLORS.success,
        trend: "-5%",
      },
      {
        title: "Active Users",
        value: uniqueUsers.toLocaleString(),
        icon: Users,
        color: COLORS.info,
        trend: "+8%",
      },
      {
        title: "Unique IPs",
        value: uniqueIPs.toLocaleString(),
        icon: Globe,
        color: COLORS.secondary,
        trend: "+15%",
      },
      {
        title: "Active Services",
        value: servicePerformance?.length || 0,
        icon: Database,
        color: COLORS.accent,
      },
    ];
  }, [requestVolumeData, topActiveIps, errorTrends, servicePerformance]);

  // Chart click handlers
  const handleChartClick = useCallback(
    async (type: "ip" | "service", value: string) => {
      if (!startDateFilter || !endDateFilter) return;

      try {
        let data: any[] = [];

        if (type === "ip") {
          const result = await getIpActivityDetailAction({
            ipAddress: value,
            startDate: startDateFilter.toISOString(),
            endDate: endDateFilter.toISOString(),
            granularity: "hour",
          });
          data = result.data || [];
        } else if (type === "service") {
          // For service drill-down, get filtered logs for that service
          const result = await getFilteredLogsAction({
            page: 1,
            limit: 100,
            startDate: startDateFilter.toISOString(),
            endDate: endDateFilter.toISOString(),
            serviceName: value,
          });
          data = result.data?.logs || [];
        }

        setDrillDown({
          isOpen: true,
          type,
          value,
          data,
        });
      } catch (error) {
        toast.error("Failed to load drill-down data");
      }
    },
    [startDateFilter, endDateFilter]
  );

  const formatTooltipLabel = useCallback((label: string) => {
    return format(new Date(label), "MMM dd, yyyy HH:mm");
  }, []);

  const formatXAxisLabel = useCallback(
    (tickItem: string) => {
      const date = new Date(tickItem);
      if (granularity === "hour") {
        return format(date, "HH:mm");
      } else if (granularity === "day") {
        return format(date, "MMM dd");
      } else {
        return format(date, "MMM dd");
      }
    },
    [granularity]
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 text-white">
      <div className="container mx-auto p-6 space-y-8">
        {/* Header */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
          <div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              System Analytics Dashboard
            </h1>
            <p className="text-slate-400 mt-2">
              Real-time monitoring and insights into system performance
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                fetchOverviewData();
                fetchLogs();
              }}
              disabled={isLoadingOverview || isLoadingLogs}
              className="border-slate-600 hover:bg-slate-800"
            >
              <RefreshCw
                className={`h-4 w-4 ${
                  isLoadingOverview || isLoadingLogs ? "animate-spin" : ""
                }`}
              />
              Refresh
            </Button>

            <div className="flex items-center gap-2 bg-slate-900/50 p-2 rounded-lg border border-slate-700">
              {["last24h", "last7d", "last30d", "last3m"].map((range) => (
                <Button
                  key={range}
                  variant={activeDateRange === range ? "default" : "ghost"}
                  size="sm"
                  onClick={() => handleSetDateRange(range)}
                  className={`text-xs ${
                    activeDateRange === range
                      ? "bg-blue-600 hover:bg-blue-700"
                      : "hover:bg-slate-800"
                  }`}
                >
                  {range === "last24h" && "24H"}
                  {range === "last7d" && "7D"}
                  {range === "last30d" && "30D"}
                  {range === "last3m" && "3M"}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {/* Metrics Overview */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {metrics.map((metric, index) => (
            <Card
              key={index}
              className="bg-slate-900/50 border-slate-700 hover:bg-slate-800/50 transition-all duration-200"
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-slate-400 font-medium">
                      {metric.title}
                    </p>
                    <p
                      className="text-2xl font-bold"
                      style={{ color: metric.color }}
                    >
                      {metric.value}
                    </p>
                    {metric.trend && (
                      <Badge
                        variant="secondary"
                        className={`text-xs mt-1 ${
                          metric.trend.startsWith("+")
                            ? "bg-green-900/30 text-green-400"
                            : "bg-red-900/30 text-red-400"
                        }`}
                      >
                        {metric.trend}
                      </Badge>
                    )}
                  </div>
                  <metric.icon
                    className="h-8 w-8 opacity-60"
                    style={{ color: metric.color }}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Main Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Request Volume Over Time */}
          <Card className="bg-slate-900/50 border-slate-700">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-blue-400" />
                Request Volume & Performance
              </CardTitle>
              <CardDescription className="text-slate-400">
                Real-time request metrics and response times
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingOverview ? (
                <div className="h-64 flex items-center justify-center">
                  <RefreshCw className="h-8 w-8 animate-spin text-blue-400" />
                </div>
              ) : requestVolumeData && requestVolumeData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={requestVolumeData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis
                      dataKey="time_bucket"
                      tickFormatter={formatXAxisLabel}
                      stroke="#64748b"
                      fontSize={12}
                    />
                    <YAxis yAxisId="left" stroke="#64748b" fontSize={12} />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      stroke="#64748b"
                      fontSize={12}
                    />
                    <Tooltip
                      labelFormatter={formatTooltipLabel}
                      contentStyle={{
                        backgroundColor: "#1e293b",
                        border: "1px solid #475569",
                        borderRadius: "8px",
                        color: "#f1f5f9",
                      }}
                    />
                    <Legend />
                    <Area
                      yAxisId="left"
                      type="monotone"
                      dataKey="total_requests"
                      fill="url(#requestGradient)"
                      stroke={COLORS.primary}
                      strokeWidth={2}
                      name="Total Requests"
                    />
                    <Bar
                      yAxisId="left"
                      dataKey="error_requests"
                      fill={COLORS.danger}
                      name="Error Requests"
                      opacity={0.7}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="avg_duration_ms"
                      stroke={COLORS.warning}
                      strokeWidth={2}
                      name="Avg Response Time (ms)"
                      dot={{ r: 3 }}
                    />
                    <defs>
                      <linearGradient
                        id="requestGradient"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor={COLORS.primary}
                          stopOpacity={0.8}
                        />
                        <stop
                          offset="95%"
                          stopColor={COLORS.primary}
                          stopOpacity={0.1}
                        />
                      </linearGradient>
                    </defs>
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-slate-400">
                  No data available for this time range
                </div>
              )}
            </CardContent>
          </Card>

          {/* Error Trends */}
          <Card className="bg-slate-900/50 border-slate-700">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-400" />
                Error Trends Analysis
              </CardTitle>
              <CardDescription className="text-slate-400">
                Monitor error patterns and severity levels
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingOverview ? (
                <div className="h-64 flex items-center justify-center">
                  <RefreshCw className="h-8 w-8 animate-spin text-red-400" />
                </div>
              ) : errorTrends && errorTrends.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={errorTrends}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis
                      dataKey="time_bucket"
                      tickFormatter={formatXAxisLabel}
                      stroke="#64748b"
                      fontSize={12}
                    />
                    <YAxis stroke="#64748b" fontSize={12} />
                    <Tooltip
                      labelFormatter={formatTooltipLabel}
                      contentStyle={{
                        backgroundColor: "#1e293b",
                        border: "1px solid #475569",
                        borderRadius: "8px",
                        color: "#f1f5f9",
                      }}
                    />
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="fatal_count"
                      stackId="1"
                      stroke={COLORS.danger}
                      fill={COLORS.danger}
                      name="Fatal"
                    />
                    <Area
                      type="monotone"
                      dataKey="error_count"
                      stackId="1"
                      stroke="#ff6b6b"
                      fill="#ff6b6b"
                      name="Error"
                    />
                    <Area
                      type="monotone"
                      dataKey="warn_count"
                      stackId="1"
                      stroke={COLORS.warning}
                      fill={COLORS.warning}
                      name="Warning"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-slate-400">
                  No error data available
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Service Performance & Top IPs */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Service Performance */}
          <Card className="lg:col-span-2 bg-slate-900/50 border-slate-700">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5 text-green-400" />
                Service Performance Matrix
              </CardTitle>
              <CardDescription className="text-slate-400">
                Detailed performance metrics by service
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingOverview ? (
                <div className="h-64 flex items-center justify-center">
                  <RefreshCw className="h-8 w-8 animate-spin text-green-400" />
                </div>
              ) : servicePerformance && servicePerformance.length > 0 ? (
                <div className="space-y-4">
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart
                      data={servicePerformance.slice(0, 8)}
                      layout="horizontal"
                      margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis
                        type="number"
                        stroke="#64748b"
                        fontSize={12}
                        tick={{ fill: "#64748b" }}
                      />
                      <YAxis
                        type="category"
                        dataKey="service_name"
                        stroke="#64748b"
                        fontSize={12}
                        width={100}
                        tick={{ fill: "#64748b" }}
                      />
                      <Tooltip
                        cursor={{ fill: "rgba(59, 130, 246, 0.1)" }}
                        content={({ active, payload, label }) => {
                          if (active && payload && payload.length) {
                            return (
                              <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 shadow-lg">
                                <p className="text-slate-200 font-medium text-sm">
                                  {label}
                                </p>
                                <p className="text-blue-400 text-sm">
                                  Requests: {payload[0].value?.toLocaleString()}
                                </p>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Bar
                        dataKey="total_requests"
                        fill={COLORS.primary}
                        onClick={(data) =>
                          handleChartClick("service", data.service_name)
                        }
                        className="cursor-pointer hover:opacity-80"
                        radius={[0, 4, 4, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    {servicePerformance.slice(0, 6).map((service, index) => (
                      <div
                        key={index}
                        className="p-3 bg-slate-800/50 rounded-lg border border-slate-600 hover:bg-slate-700/50 transition-colors cursor-pointer"
                        onClick={() =>
                          handleChartClick("service", service.service_name)
                        }
                      >
                        <div className="flex justify-between items-start mb-2">
                          <h4 className="font-medium text-sm">
                            {service.service_name}
                          </h4>
                          <Badge
                            variant="secondary"
                            className={`text-xs ${
                              service.error_rate > 5
                                ? "bg-red-900/30 text-red-400"
                                : "bg-green-900/30 text-green-400"
                            }`}
                          >
                            {service.error_rate}% errors
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
                          <div>
                            Requests: {service.total_requests.toLocaleString()}
                          </div>
                          <div>Avg: {service.avg_duration_ms}ms</div>
                          <div>P95: {service.p95_duration_ms}ms</div>
                          <div>Users: {service.unique_users}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center text-slate-400">
                  No service data available
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top Active IPs */}
          <Card className="bg-slate-900/50 border-slate-700">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5 text-purple-400" />
                Active IP Addresses
              </CardTitle>
              <CardDescription className="text-slate-400">
                Most active IP addresses by request volume
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingOverview ? (
                <div className="h-64 flex items-center justify-center">
                  <RefreshCw className="h-8 w-8 animate-spin text-purple-400" />
                </div>
              ) : topActiveIps && topActiveIps.length > 0 ? (
                <div className="space-y-3 max-h-[32rem] overflow-y-auto pr-2">
                  {topActiveIps.map((ip, index) => (
                    <div
                      key={index}
                      className="p-3 bg-slate-800/50 rounded-lg border border-slate-600 hover:bg-slate-700/50 transition-colors cursor-pointer"
                      onClick={() => handleChartClick("ip", ip.ip_address)}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm text-blue-400">
                            {ip.ip_address}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            #{index + 1}
                          </Badge>
                        </div>
                        <Badge
                          variant="secondary"
                          className={`text-xs ${
                            ip.error_rate > 10
                              ? "bg-red-900/30 text-red-400"
                              : "bg-green-900/30 text-green-400"
                          }`}
                        >
                          {ip.error_rate}%
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-1 text-xs text-slate-400">
                        <div>
                          Requests: {ip.total_requests.toLocaleString()}
                        </div>
                        <div>Actions: {ip.unique_actions}</div>
                        <div>Services: {ip.unique_services}</div>
                        <div>Avg: {ip.avg_duration_ms}ms</div>
                      </div>
                      <div className="mt-2 text-xs text-slate-500">
                        Last seen:{" "}
                        {formatDistanceToNow(new Date(ip.last_seen), {
                          addSuffix: true,
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center text-slate-400">
                  No IP data available
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Log Level Distribution */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <Card className="bg-slate-900/50 border-slate-700">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-yellow-400" />
                Log Levels
              </CardTitle>
            </CardHeader>
            <CardContent>
              {logLevelStats && logLevelStats.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={logLevelStats}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="item_count"
                      nameKey="group_key"
                    >
                      {logLevelStats.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={
                            LOG_LEVEL_COLORS[entry.group_key as LogLevel] ||
                            PIE_CHART_COLORS[index % PIE_CHART_COLORS.length]
                          }
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#0f172a",
                        border: "1px solid #334155",
                        borderRadius: "8px",
                        color: "#f8fafc",
                        fontSize: "12px",
                        padding: "8px",
                        boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                      }}
                      labelStyle={{ color: "#f8fafc" }}
                      itemStyle={{ color: "#f8fafc" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-48 flex items-center justify-center text-slate-400">
                  No log level data
                </div>
              )}
            </CardContent>
          </Card>

          {/* Filters */}
          <Card className="lg:col-span-3 bg-slate-900/50 border-slate-700">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Filter className="h-5 w-5 text-blue-400" />
                Advanced Filters
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Select
                  value={logLevelFilter || "all"}
                  onValueChange={(value) =>
                    setLogLevelFilter(value === "all" ? null : value)
                  }
                >
                  <SelectTrigger className="bg-slate-800 border-slate-600">
                    <SelectValue placeholder="Log Level" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Levels</SelectItem>
                    {LOG_LEVELS.map((level) => (
                      <SelectItem key={level} value={level}>
                        {level}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Input
                  placeholder="Service Name"
                  value={serviceNameFilter || ""}
                  onChange={(e) => setServiceNameFilter(e.target.value)}
                  className="bg-slate-800 border-slate-600"
                />

                <Input
                  placeholder="Action Name"
                  value={actionNameFilter || ""}
                  onChange={(e) => setActionNameFilter(e.target.value)}
                  className="bg-slate-800 border-slate-600"
                />

                <Input
                  placeholder="IP Address"
                  value={ipAddressFilter || ""}
                  onChange={(e) => setIpAddressFilter(e.target.value)}
                  className="bg-slate-800 border-slate-600"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Detailed Logs Table */}
        <Card className="bg-slate-900/50 border-slate-700">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5 text-green-400" />
              System Logs
              {logsData && (
                <Badge variant="secondary" className="ml-2">
                  {logsData.totalCount.toLocaleString()} entries
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingLogs ? (
              <div className="h-64 flex items-center justify-center">
                <RefreshCw className="h-8 w-8 animate-spin text-green-400" />
              </div>
            ) : logsData && logsData.logs.length > 0 ? (
              <>
                <div className="rounded-lg border border-slate-700 overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-800/50 border-slate-700">
                        <TableHead className="text-slate-300">Time</TableHead>
                        <TableHead className="text-slate-300">Level</TableHead>
                        <TableHead className="text-slate-300">
                          Service
                        </TableHead>
                        <TableHead className="text-slate-300">Action</TableHead>
                        <TableHead className="text-slate-300">IP</TableHead>
                        <TableHead className="text-slate-300">
                          Duration
                        </TableHead>
                        <TableHead className="text-slate-300">
                          Details
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logsData.logs.map((log: LogEntry) => (
                        <TableRow
                          key={log.id}
                          className="border-slate-700 hover:bg-slate-800/30 transition-colors"
                        >
                          <TableCell className="font-mono text-xs text-slate-400">
                            {log.created_at
                              ? format(new Date(log.created_at), "HH:mm:ss")
                              : "N/A"}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="secondary"
                              className={`text-xs ${
                                log.log_level === "ERROR" ||
                                log.log_level === "FATAL"
                                  ? "bg-red-900/30 text-red-400"
                                  : log.log_level === "WARN"
                                  ? "bg-yellow-900/30 text-yellow-400"
                                  : log.log_level === "INFO"
                                  ? "bg-blue-900/30 text-blue-400"
                                  : "bg-gray-900/30 text-gray-400"
                              }`}
                            >
                              {log.log_level}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {log.service_name || "-"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {log.action_name || "-"}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-slate-400">
                            {log.ip_address || "-"}
                          </TableCell>
                          <TableCell className="text-xs text-slate-400">
                            {log.duration_ms ? `${log.duration_ms}ms` : "-"}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setSelectedLog(log);
                                setIsDetailModalOpen(true);
                              }}
                              className="h-7 px-2 hover:bg-slate-700"
                            >
                              <Eye className="h-3 w-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-700">
                  <p className="text-sm text-slate-400">
                    Showing {(page - 1) * limit + 1} to{" "}
                    {Math.min(page * limit, logsData.totalCount)} of{" "}
                    {logsData.totalCount.toLocaleString()} entries
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(Math.max(1, page - 1))}
                      disabled={page <= 1 || isLoadingLogs}
                      className="border-slate-600 hover:bg-slate-800"
                    >
                      Previous
                    </Button>
                    <span className="text-sm p-2 text-slate-400">
                      Page {page} of {logsData.totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setPage(Math.min(logsData.totalPages, page + 1))
                      }
                      disabled={page >= logsData.totalPages || isLoadingLogs}
                      className="border-slate-600 hover:bg-slate-800"
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="h-64 flex flex-col items-center justify-center text-slate-400">
                <Search className="h-12 w-12 mb-4 opacity-50" />
                <h3 className="text-lg font-medium mb-2">No logs found</h3>
                <p className="text-sm">
                  Try adjusting your filters or date range
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Log Detail Modal */}
        {selectedLog && (
          <Dialog open={isDetailModalOpen} onOpenChange={setIsDetailModalOpen}>
            <DialogContent className="max-w-4xl max-h-[90vh] bg-slate-900 border-slate-700">
              <DialogHeader>
                <DialogTitle className="text-xl text-blue-400">
                  Log Entry Details
                </DialogTitle>
                <DialogDescription>
                  Detailed information about the selected log entry including
                  all fields and metadata.
                </DialogDescription>
              </DialogHeader>
              <div className="overflow-y-auto max-h-[70vh]">
                <pre className="text-sm bg-slate-950 p-4 rounded-lg border border-slate-700 overflow-x-auto">
                  {JSON.stringify(selectedLog, null, 2)}
                </pre>
              </div>
            </DialogContent>
          </Dialog>
        )}

        {/* Drill-down Modal */}
        {drillDown.isOpen && (
          <Dialog
            open={drillDown.isOpen}
            onOpenChange={(open) =>
              setDrillDown((prev) => ({ ...prev, isOpen: open }))
            }
          >
            <DialogContent className="max-w-4xl max-h-[90vh] bg-slate-900 border-slate-700">
              <DialogHeader>
                <DialogTitle className="text-xl text-purple-400">
                  {drillDown.type === "ip"
                    ? "IP Address Activity"
                    : "Service Details"}
                  : {drillDown.value}
                </DialogTitle>
                <DialogDescription>
                  {drillDown.type === "ip"
                    ? `Detailed activity breakdown and trends for IP address ${drillDown.value}`
                    : `Performance metrics and activity details for service ${drillDown.value}`}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                {drillDown.type === "ip" && drillDown.data.length > 0 && (
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={drillDown.data}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis
                        dataKey="time_bucket"
                        tickFormatter={formatXAxisLabel}
                        stroke="#64748b"
                      />
                      <YAxis stroke="#64748b" />
                      <Tooltip
                        labelFormatter={formatTooltipLabel}
                        contentStyle={{
                          backgroundColor: "#1e293b",
                          border: "1px solid #475569",
                          borderRadius: "8px",
                          color: "#f1f5f9",
                        }}
                      />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="request_count"
                        stroke={COLORS.primary}
                        strokeWidth={2}
                        name="Requests"
                      />
                      <Line
                        type="monotone"
                        dataKey="error_count"
                        stroke={COLORS.danger}
                        strokeWidth={2}
                        name="Errors"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}

                {drillDown.type === "service" && drillDown.data.length > 0 && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <Card className="bg-slate-800/50 border-slate-600">
                        <CardContent className="p-4">
                          <div className="flex items-center gap-2">
                            <Activity className="h-5 w-5 text-blue-400" />
                            <div>
                              <p className="text-xs text-slate-400">
                                Total Logs
                              </p>
                              <p className="text-lg font-bold text-blue-400">
                                {drillDown.data.length}
                              </p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                      <Card className="bg-slate-800/50 border-slate-600">
                        <CardContent className="p-4">
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-red-400" />
                            <div>
                              <p className="text-xs text-slate-400">Errors</p>
                              <p className="text-lg font-bold text-red-400">
                                {
                                  drillDown.data.filter(
                                    (log: any) =>
                                      log.log_level === "ERROR" ||
                                      log.log_level === "FATAL"
                                  ).length
                                }
                              </p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                      <Card className="bg-slate-800/50 border-slate-600">
                        <CardContent className="p-4">
                          <div className="flex items-center gap-2">
                            <Clock className="h-5 w-5 text-yellow-400" />
                            <div>
                              <p className="text-xs text-slate-400">
                                Avg Duration
                              </p>
                              <p className="text-lg font-bold text-yellow-400">
                                {Math.round(
                                  drillDown.data
                                    .filter((log: any) => log.duration_ms)
                                    .reduce(
                                      (sum: number, log: any) =>
                                        sum + log.duration_ms,
                                      0
                                    ) /
                                    drillDown.data.filter(
                                      (log: any) => log.duration_ms
                                    ).length || 0
                                )}
                                ms
                              </p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    <div className="max-h-96 overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-slate-800/50 border-slate-700">
                            <TableHead className="text-slate-300">
                              Time
                            </TableHead>
                            <TableHead className="text-slate-300">
                              Level
                            </TableHead>
                            <TableHead className="text-slate-300">
                              Action
                            </TableHead>
                            <TableHead className="text-slate-300">IP</TableHead>
                            <TableHead className="text-slate-300">
                              Duration
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {drillDown.data
                            .slice(0, 50)
                            .map((log: any, index: number) => (
                              <TableRow
                                key={index}
                                className="border-slate-700"
                              >
                                <TableCell className="font-mono text-xs text-slate-400">
                                  {log.created_at
                                    ? format(
                                        new Date(log.created_at),
                                        "HH:mm:ss"
                                      )
                                    : "N/A"}
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant="secondary"
                                    className={`text-xs ${
                                      log.log_level === "ERROR" ||
                                      log.log_level === "FATAL"
                                        ? "bg-red-900/30 text-red-400"
                                        : log.log_level === "WARN"
                                        ? "bg-yellow-900/30 text-yellow-400"
                                        : log.log_level === "INFO"
                                        ? "bg-blue-900/30 text-blue-400"
                                        : "bg-gray-900/30 text-gray-400"
                                    }`}
                                  >
                                    {log.log_level}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-sm">
                                  {log.action_name || "-"}
                                </TableCell>
                                <TableCell className="font-mono text-xs text-slate-400">
                                  {log.ip_address || "-"}
                                </TableCell>
                                <TableCell className="text-xs text-slate-400">
                                  {log.duration_ms
                                    ? `${log.duration_ms}ms`
                                    : "-"}
                                </TableCell>
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                {drillDown.data.length === 0 && (
                  <div className="h-64 flex flex-col items-center justify-center text-slate-400">
                    <Database className="h-12 w-12 mb-4 opacity-50" />
                    <h3 className="text-lg font-medium mb-2">
                      No data available
                    </h3>
                    <p className="text-sm">
                      No{" "}
                      {drillDown.type === "ip" ? "IP activity" : "service logs"}{" "}
                      found for this time range
                    </p>
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </div>
  );
}
