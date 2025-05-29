"use client";

import { useEffect, useState, useCallback } from "react";
import {
  useQueryState,
  parseAsInteger,
  parseAsString,
  parseAsIsoDateTime,
} from "nuqs";
import { getLogsAction, getLogStatsAction } from "@/app/actions/admin/logs";
import type {
  PaginatedLogsResponse as AdminPaginatedLogsResponse,
  LogStat as AdminLogStat,
} from "@/app/actions/admin/logs";
import type { LogEntry, LogLevel } from "@/lib/logger";
import { Button } from "@/components/ui/button"; // Assuming shadcn/ui Button
import { Input } from "@/components/ui/input"; // Assuming shadcn/ui Input
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"; // Assuming shadcn/ui Select
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"; // Assuming shadcn/ui Table
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"; // Assuming shadcn/ui Card
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"; // Assuming shadcn/ui Dialog
import { toast } from "sonner"; // Assuming sonner for toasts
import {
  BarChart,
  Bar,
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

const LOG_LEVELS: LogLevel[] = ["DEBUG", "INFO", "WARN", "ERROR", "FATAL"];
const GROUP_BY_OPTIONS = [
  "log_level",
  "service_name",
  "action_name",
  "error_code",
] as const;
type GroupByOption = (typeof GROUP_BY_OPTIONS)[number];

const PIE_CHART_COLORS = [
  "#0088FE",
  "#00C49F",
  "#FFBB28",
  "#FF8042",
  "#8884D8",
];
const BAR_CHART_FILL_COLOR = "hsl(var(--primary))";

export default function AdminLogsPage() {
  const [logsData, setLogsData] = useState<AdminPaginatedLogsResponse | null>(
    null
  );
  // Stats for the filterable table/section
  const [generalStatsData, setGeneralStatsData] = useState<
    AdminLogStat[] | null
  >(null);
  // Dedicated stats for charts
  const [logLevelChartData, setLogLevelChartData] = useState<
    AdminLogStat[] | null
  >(null);
  const [serviceNameChartData, setServiceNameChartData] = useState<
    AdminLogStat[] | null
  >(null);
  const [errorCodeChartData, setErrorCodeChartData] = useState<
    AdminLogStat[] | null
  >(null);

  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [isLoadingGeneralStats, setIsLoadingGeneralStats] = useState(false);
  const [isLoadingCharts, setIsLoadingCharts] = useState(false);
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  // Filters using nuqs
  const [page, setPage] = useQueryState("page", parseAsInteger.withDefault(1));
  const [limit, setLimit] = useQueryState(
    "limit",
    parseAsInteger.withDefault(10)
  );
  const [logLevelFilter, setLogLevelFilter] = useQueryState<LogLevel | null>(
    "logLevel",
    parseAsString.withDefault("").withOptions({ shallow: false }) as any
  );
  const [serviceNameFilter, setServiceNameFilter] = useQueryState(
    "service",
    parseAsString.withDefault("").withOptions({ shallow: false })
  );
  const [actionNameFilter, setActionNameFilter] = useQueryState(
    "action",
    parseAsString.withDefault("").withOptions({ shallow: false })
  );
  const [userIdFilter, setUserIdFilter] = useQueryState(
    "userId",
    parseAsString.withDefault("").withOptions({ shallow: false })
  );
  const [startDateFilter, setStartDateFilter] = useQueryState(
    "startDate",
    parseAsIsoDateTime.withOptions({ shallow: false })
  );
  const [endDateFilter, setEndDateFilter] = useQueryState(
    "endDate",
    parseAsIsoDateTime.withOptions({ shallow: false })
  );
  const [statsGroupBy, setStatsGroupBy] = useQueryState<GroupByOption>(
    "statsGroupBy",
    parseAsString
      .withDefault("log_level")
      .withOptions({ shallow: false }) as any
  );

  const fetchLogs = useCallback(async () => {
    setIsLoadingLogs(true);
    const result = await getLogsAction({
      page,
      limit,
      logLevel: logLevelFilter || undefined,
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
    logLevelFilter,
    serviceNameFilter,
    actionNameFilter,
    userIdFilter,
    startDateFilter,
    endDateFilter,
  ]);

  const fetchGeneralStats = useCallback(async () => {
    setIsLoadingGeneralStats(true);
    const result = await getLogStatsAction({
      groupBy: statsGroupBy || "log_level",
      startDate: startDateFilter?.toISOString(),
      endDate: endDateFilter?.toISOString(),
    });

    if (result.data) {
      setGeneralStatsData(result.data);
    } else {
      setGeneralStatsData(null);
      if (result.serverError) {
        toast.error(result.serverError || "Failed to fetch general stats");
      } else if (result.validationError) {
        const errorMessages = Object.values(result.validationError)
          .flat()
          .join(", ");
        toast.error(`Validation Error (General Stats): ${errorMessages}`);
      } else {
        toast.error(
          "An unexpected error occurred while fetching general stats."
        );
      }
    }
    setIsLoadingGeneralStats(false);
  }, [statsGroupBy, startDateFilter, endDateFilter]);

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
      // Filter out null/empty error codes
      else if (errors.serverError)
        toast.error(`Chart Error (Error Codes): ${errors.serverError}`);
    } catch (error) {
      toast.error("Failed to load chart data.");
      console.error("Chart data fetch error:", error);
    }
    setIsLoadingCharts(false);
  }, [startDateFilter, endDateFilter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    fetchGeneralStats();
  }, [fetchGeneralStats]);

  useEffect(() => {
    fetchAllChartData();
  }, [fetchAllChartData]);

  const handleApplyFilters = () => {
    fetchLogs();
    fetchGeneralStats();
    fetchAllChartData();
  };

  const handleViewDetails = (log: LogEntry) => {
    setSelectedLog(log);
    setIsDetailModalOpen(true);
  };

  const handleCloseDetailsModal = () => {
    setSelectedLog(null);
    setIsDetailModalOpen(false);
  };

  return (
    <div className="space-y-8 p-4 md:p-6 lg:p-8">
      <h1 className="text-3xl font-bold tracking-tight">
        Application Logs Dashboard
      </h1>

      {/* Charts Section */}
      <section>
        <h2 className="text-2xl font-semibold mb-6 tracking-tight">
          Activity Overview
        </h2>
        {isLoadingCharts && (
          <p className="text-muted-foreground">Loading charts...</p>
        )}
        {!isLoadingCharts && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
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
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-muted-foreground text-sm">
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
                      margin={{ left: 30, right: 30 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis
                        dataKey="group_key"
                        type="category"
                        width={120}
                        interval={0}
                      />
                      <Tooltip />
                      <Legend />
                      <Bar
                        dataKey="item_count"
                        name="Log Count"
                        fill={BAR_CHART_FILL_COLOR}
                        barSize={20}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-muted-foreground text-sm">
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
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="group_key" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar
                      dataKey="item_count"
                      name="Error Count"
                      fill="hsl(var(--destructive))"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
      </section>

      {/* General Stats & Filters Section */}
      <section className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Filterable Log Statistics</CardTitle>
            <CardDescription>
              Dynamic statistics based on the filters below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground">Group by:</span>
              <Select
                value={statsGroupBy}
                onValueChange={(val) => setStatsGroupBy(val as GroupByOption)}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Group by..." />
                </SelectTrigger>
                <SelectContent>
                  {GROUP_BY_OPTIONS.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt.replace("_", " ").toUpperCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {isLoadingGeneralStats && (
              <p className="text-muted-foreground">Loading statistics...</p>
            )}
            {!isLoadingGeneralStats && generalStatsData && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 pt-4">
                {generalStatsData.map((stat) => (
                  <Card key={stat.group_key} className="text-center">
                    <CardHeader className="p-4">
                      <CardTitle className="text-base font-medium">
                        {stat.group_key || "N/A"}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <div className="text-3xl font-bold">
                        {stat.item_count}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
            {!isLoadingGeneralStats && !generalStatsData && (
              <p className="text-muted-foreground text-sm">
                No statistics for current filter and grouping.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
            <CardDescription>Refine logs and statistics view.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 items-end">
              <Input
                type="datetime-local"
                placeholder="Start Date"
                value={
                  startDateFilter
                    ? startDateFilter.toISOString().slice(0, 16)
                    : ""
                }
                onChange={(e) =>
                  setStartDateFilter(
                    e.target.value ? new Date(e.target.value) : null
                  )
                }
              />
              <Input
                type="datetime-local"
                placeholder="End Date"
                value={
                  endDateFilter ? endDateFilter.toISOString().slice(0, 16) : ""
                }
                onChange={(e) =>
                  setEndDateFilter(
                    e.target.value ? new Date(e.target.value) : null
                  )
                }
              />
              <Select
                value={logLevelFilter || ""}
                onValueChange={(val) =>
                  setLogLevelFilter(val as LogLevel | null)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Log Level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All Levels</SelectItem>
                  {LOG_LEVELS.map((level) => (
                    <SelectItem key={level} value={level}>
                      {level}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="Service Name"
                value={serviceNameFilter}
                onChange={(e) => setServiceNameFilter(e.target.value)}
              />
              <Input
                placeholder="Action Name"
                value={actionNameFilter}
                onChange={(e) => setActionNameFilter(e.target.value)}
              />
              <Input
                placeholder="User ID (UUID)"
                value={userIdFilter}
                onChange={(e) => setUserIdFilter(e.target.value)}
              />
            </div>
            <Button onClick={handleApplyFilters}>Apply Filters</Button>
          </CardContent>
        </Card>
      </section>

      {/* Logs Table Section */}
      <section>
        <Card>
          <CardHeader>
            <CardTitle>Detailed Logs</CardTitle>
            <CardDescription>
              Paginated view of application logs. Current Page: {page}, Limit:{" "}
              {limit}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingLogs && (
              <p className="text-muted-foreground">Loading logs...</p>
            )}
            {!isLoadingLogs && logsData && logsData.logs.length > 0 && (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Timestamp</TableHead>
                      <TableHead>Level</TableHead>
                      <TableHead>Service</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead className="w-[30%]">Message</TableHead>
                      <TableHead>User ID</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logsData.logs.map((log: LogEntry) => (
                      <TableRow key={log.id}>
                        <TableCell>
                          {new Date(log.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell>{log.log_level}</TableCell>
                        <TableCell>{log.service_name}</TableCell>
                        <TableCell>{log.action_name}</TableCell>
                        <TableCell
                          className="max-w-xs truncate"
                          title={
                            log.error_message || JSON.stringify(log.metadata)
                          }
                        >
                          {log.error_message || "-"}
                        </TableCell>
                        <TableCell>{log.user_id || "-"}</TableCell>
                        <TableCell>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleViewDetails(log)}
                          >
                            View Details
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">
                    Total Logs: {logsData.totalCount}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                    >
                      Previous
                    </Button>
                    <span className="text-sm p-2">
                      Page {logsData.currentPage} of {logsData.totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setPage((p) => Math.min(logsData.totalPages, p + 1))
                      }
                      disabled={page >= logsData.totalPages}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </>
            )}
            {!isLoadingLogs && (!logsData || logsData.logs.length === 0) && (
              <p className="text-muted-foreground text-sm">
                No logs found for the selected filters.
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Selected Log Details Modal */}
      {selectedLog && (
        <Dialog
          open={isDetailModalOpen}
          onOpenChange={(open) => {
            if (!open) {
              handleCloseDetailsModal();
            }
          }}
        >
          <DialogContent className="max-w-2xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle>Log Details</DialogTitle>
              <DialogClose asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-4 right-4 h-7 w-7"
                  onClick={handleCloseDetailsModal}
                >
                  <CrossIcon className="h-4 w-4" />
                </Button>
              </DialogClose>
            </DialogHeader>
            <div className="p-4 text-xs overflow-y-auto max-h-[calc(80vh-120px)]">
              <pre className="whitespace-pre-wrap break-all">
                {JSON.stringify(selectedLog, null, 2)}
              </pre>
            </div>
            <DialogFooter className="sm:justify-start px-4 pb-4">
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

// Simple X icon for the modal close button
function CrossIcon(props: React.SVGProps<SVGSVGElement>): JSX.Element {
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
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
