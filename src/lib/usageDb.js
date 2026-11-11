// Shim → re-export from new SQLite-based DB layer (src/lib/db/)
export {
  statsEmitter, trackPendingRequest, getActiveRequests, getMemberActiveRequests,
  saveRequestUsage, getUsageHistory, getUsageRowsBetween, getUsageStats, getMemberUsageStats, getChartData, getMemberChartData, getMemberDistinctProviders,
  appendRequestLog, getRecentLogs, calculateCost, sanitizeUsageStatsForBrowser,
  saveRequestDetail, getRequestDetails, getRequestDetailById, isObservabilityEnabled,
} from "@/lib/db/index.js";
