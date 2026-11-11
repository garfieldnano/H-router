"use client";

import { useState, useEffect, useCallback } from "react";
import { Button, Card, Collapse, DatePicker, Drawer, Select, Table } from "antd";
import dayjs from "dayjs";
import { cn } from "@/shared/utils/cn";
import { AI_PROVIDERS, getProviderByAlias } from "@/shared/constants/providers";

let providerNameCache = null;
let providerNodesCache = null;

async function fetchProviderNames() {
  if (providerNameCache && providerNodesCache) {
    return { providerNameCache, providerNodesCache };
  }

  const nodesRes = await fetch("/api/provider-nodes");
  const nodesData = await nodesRes.json();
  const nodes = nodesData.nodes || [];
  providerNodesCache = {};

  for (const node of nodes) {
    providerNodesCache[node.id] = node.name;
  }

  providerNameCache = {
    ...AI_PROVIDERS,
    ...providerNodesCache
  };

  return { providerNameCache, providerNodesCache };
}

function getProviderName(providerId, cache) {
  if (!providerId) return providerId;
  if (!cache) return providerId;

  const cached = cache[providerId];

  if (typeof cached === 'string') {
    return cached;
  }

  if (cached?.name) {
    return cached.name;
  }

  const providerConfig = getProviderByAlias(providerId) || AI_PROVIDERS[providerId];
  return providerConfig?.name || providerId;
}

function getCachedTokens(tokens) {
  return tokens?.cached_tokens || tokens?.cache_read_input_tokens || 0;
}

function getCacheCreationTokens(tokens) {
  return tokens?.cache_creation_input_tokens || 0;
}

function getInputTokens(tokens) {
  const prompt = tokens?.prompt_tokens || tokens?.input_tokens || 0;
  // Canonical storage keeps prompt cache-inclusive. Legacy Claude rows may have
  // stored prompt cache-exclusive; fall back to cache when it's larger so old
  // rows don't under-report input.
  const cache = getCachedTokens(tokens);
  return prompt < cache ? cache : prompt;
}

const DATE_FORMAT = "YYYY-MM-DDTHH:mm";

export default function RequestDetailsTab() {
  const [details, setDetails] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20,
    totalItems: 0,
    totalPages: 0
  });
  const [loading, setLoading] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [providers, setProviders] = useState([]);
  const [providerNameCache, setProviderNameCache] = useState(null);
  const [filters, setFilters] = useState({
    provider: "",
    startDate: "",
    endDate: ""
  });

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch("/api/usage/providers");
      const data = await res.json();
      setProviders(data.providers || []);

      const cache = await fetchProviderNames();
      setProviderNameCache(cache.providerNameCache);
    } catch (error) {
      console.error("Failed to fetch providers:", error);
    }
  }, []);

  const fetchDetails = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        pageSize: pagination.pageSize.toString()
      });
      if (filters.provider) params.append("provider", filters.provider);
      if (filters.startDate) params.append("startDate", filters.startDate);
      if (filters.endDate) params.append("endDate", filters.endDate);

      const res = await fetch(`/api/usage/request-details?${params}`);
      const data = await res.json();

      setDetails(data.details || []);
      setPagination(prev => ({ ...prev, ...data.pagination }));
    } catch (error) {
      console.error("Failed to fetch request details:", error);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, filters]);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  const handleViewDetail = (detail) => {
    setSelectedDetail(detail);
    setIsDrawerOpen(true);
  };

  const handlePageChange = (newPage) => {
    setPagination(prev => ({ ...prev, page: newPage }));
  };

  const handlePageSizeChange = (newPageSize) => {
    setPagination(prev => ({ ...prev, pageSize: newPageSize, page: 1 }));
  };

  const handleClearFilters = () => {
    setFilters({ provider: "", startDate: "", endDate: "" });
  };

  const columns = [
    {
      title: "Timestamp",
      dataIndex: "timestamp",
      key: "timestamp",
      render: (ts) => (
        <span className="whitespace-nowrap text-sm text-text-main">
          {new Date(ts).toLocaleString()}
        </span>
      ),
    },
    {
      title: "Model",
      dataIndex: "model",
      key: "model",
      ellipsis: true,
      render: (model) => (
        <span className="font-mono text-sm text-text-main">{model}</span>
      ),
    },
    {
      title: "Provider",
      dataIndex: "provider",
      key: "provider",
      ellipsis: true,
      render: (_, r) => (
        <span className="font-medium">
          {getProviderName(r.provider, providerNameCache)}
        </span>
      ),
    },
    {
      title: "Input Tokens",
      dataIndex: "inputTokens",
      key: "inputTokens",
      align: "right",
      render: (_, r) => (
        <span className="font-mono text-sm text-text-main">
          {getInputTokens(r.tokens).toLocaleString()}
        </span>
      ),
    },
    {
      title: "Cached",
      dataIndex: "cached",
      key: "cached",
      align: "right",
      render: (_, r) => (
        <span className="font-mono text-sm text-text-main">
          {getCachedTokens(r.tokens) > 0
            ? getCachedTokens(r.tokens).toLocaleString()
            : "—"}
        </span>
      ),
    },
    {
      title: "Cache Creation",
      dataIndex: "cacheCreation",
      key: "cacheCreation",
      align: "right",
      render: (_, r) => (
        <span className="font-mono text-sm text-text-main">
          {getCacheCreationTokens(r.tokens) > 0
            ? getCacheCreationTokens(r.tokens).toLocaleString()
            : "—"}
        </span>
      ),
    },
    {
      title: "Output Tokens",
      dataIndex: "outputTokens",
      key: "outputTokens",
      align: "right",
      render: (_, r) => (
        <span className="font-mono text-sm text-text-main">
          {r.tokens?.completion_tokens?.toLocaleString() || 0}
        </span>
      ),
    },
    {
      title: "Latency",
      dataIndex: "latency",
      key: "latency",
      render: (_, r) => (
        <div className="flex flex-col gap-0.5 text-sm text-text-muted">
          <div>
            TTFT: <span className="font-mono">{r.latency?.ttft || 0}ms</span>
          </div>
          <div>
            Total: <span className="font-mono">{r.latency?.total || 0}ms</span>
          </div>
        </div>
      ),
    },
    {
      title: "Action",
      dataIndex: "action",
      key: "action",
      align: "center",
      render: (_, r) => (
        <Button size="small" onClick={() => handleViewDetail(r)}>
          Detail
        </Button>
      ),
    },
  ];

  const collapseItems = selectedDetail
    ? [
        {
          key: "1",
          label: (
            <span className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-text-muted">input</span>
              <span className="font-semibold text-sm">1. Client Request (Input)</span>
            </span>
          ),
          children: (
            <pre className="max-h-[300px] max-w-full overflow-auto rounded-md border border-black/5 bg-black/5 p-3 font-mono text-xs text-text-main dark:border-white/5 dark:bg-white/5 sm:p-4">
              {JSON.stringify(selectedDetail.request, null, 2)}
            </pre>
          ),
        },
        ...(selectedDetail.providerRequest
          ? [
              {
                key: "2",
                label: (
                  <span className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px] text-text-muted">translate</span>
                    <span className="font-semibold text-sm">2. Provider Request (Translated)</span>
                  </span>
                ),
                children: (
                  <pre className="max-h-[300px] max-w-full overflow-auto rounded-md border border-black/5 bg-black/5 p-3 font-mono text-xs text-text-main dark:border-white/5 dark:bg-white/5 sm:p-4">
                    {JSON.stringify(selectedDetail.providerRequest, null, 2)}
                  </pre>
                ),
              },
            ]
          : []),
        ...(selectedDetail.providerResponse
          ? [
              {
                key: "3",
                label: (
                  <span className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px] text-text-muted">data_object</span>
                    <span className="font-semibold text-sm">3. Provider Response (Raw)</span>
                  </span>
                ),
                children: (
                  <pre className="max-h-[300px] max-w-full overflow-auto rounded-md border border-black/5 bg-black/5 p-3 font-mono text-xs text-text-main dark:border-white/5 dark:bg-white/5 sm:p-4">
                    {typeof selectedDetail.providerResponse === "object"
                      ? JSON.stringify(selectedDetail.providerResponse, null, 2)
                      : selectedDetail.providerResponse}
                  </pre>
                ),
              },
            ]
          : []),
        {
          key: "4",
          label: (
            <span className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-text-muted">output</span>
              <span className="font-semibold text-sm">4. Client Response (Final)</span>
            </span>
          ),
          children: (
            <div className="space-y-4">
              {selectedDetail.response?.thinking && (
                <div>
                  <h4 className="font-semibold text-text-main mb-2 flex items-center gap-2 text-xs uppercase tracking-wide opacity-70">
                    <span className="material-symbols-outlined text-[16px]">psychology</span>
                    Thinking Process
                  </h4>
                  <pre className="max-h-[200px] max-w-full overflow-auto rounded-md border border-amber-200 bg-amber-50 p-3 font-mono text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100 sm:p-4">
                    {selectedDetail.response.thinking}
                  </pre>
                </div>
              )}
              <div>
                <h4 className="font-semibold text-text-main mb-2 text-xs uppercase tracking-wide opacity-70">
                  Content
                </h4>
                <pre className="max-h-[300px] max-w-full overflow-auto rounded-md border border-black/5 bg-black/5 p-3 font-mono text-xs text-text-main dark:border-white/5 dark:bg-white/5 sm:p-4">
                  {selectedDetail.response?.content || "[No content]"}
                </pre>
              </div>
            </div>
          ),
        },
      ]
    : [];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor="provider-filter" className="text-sm font-medium text-text-main">Provider</label>
            <Select
              id="provider-filter"
              value={filters.provider}
              onChange={(v) => setFilters({ ...filters, provider: v })}
              options={[
                { value: "", label: "All Providers" },
                ...providers.map((provider) => ({
                  value: provider.id,
                  label: provider.name,
                })),
              ]}
              className="w-full"
            />
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor="start-date-filter" className="text-sm font-medium text-text-main">Start Date</label>
            <DatePicker
              id="start-date-filter"
              showTime
              format={DATE_FORMAT}
              value={filters.startDate ? dayjs(filters.startDate) : null}
              onChange={(_, dateString) =>
                setFilters({ ...filters, startDate: dateString })
              }
              className="w-full"
              placeholder="Start date"
            />
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor="end-date-filter" className="text-sm font-medium text-text-main">End Date</label>
            <DatePicker
              id="end-date-filter"
              showTime
              format={DATE_FORMAT}
              value={filters.endDate ? dayjs(filters.endDate) : null}
              onChange={(_, dateString) =>
                setFilters({ ...filters, endDate: dateString })
              }
              className="w-full"
              placeholder="End date"
            />
          </div>

          <div className="flex min-w-0 flex-col gap-2 sm:col-span-2 lg:col-span-1">
            <span className="hidden text-sm font-medium text-text-main opacity-0 lg:block" aria-hidden="true">Clear</span>
            <Button
              type="text"
              onClick={handleClearFilters}
              disabled={!filters.provider && !filters.startDate && !filters.endDate}
              className="w-full"
            >
              Clear Filters
            </Button>
          </div>
        </div>
      </Card>

      <Card styles={{ body: { padding: 0 } }}>
        <Table
          columns={columns}
          dataSource={details}
          rowKey={(record, index) => `${record.id}-${index}`}
          loading={loading}
          pagination={{
            current: pagination.page,
            pageSize: pagination.pageSize,
            total: pagination.totalItems,
            showSizeChanger: true,
            onChange: (page, pageSize) => {
              if (pageSize !== pagination.pageSize) {
                handlePageSizeChange(pageSize);
              } else {
                handlePageChange(page);
              }
            },
          }}
          scroll={{ x: 880 }}
          locale={{ emptyText: "No request details found" }}
        />
      </Card>

      <Drawer
        title="Request Details"
        open={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        width={720}
      >
        {selectedDetail && (
          <div className="space-y-6">
            <div className="grid min-w-0 grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div>
                <span className="text-text-muted">ID:</span>{" "}
                <span className="break-all font-mono text-text-main">{selectedDetail.id}</span>
              </div>
              <div>
                <span className="text-text-muted">Timestamp:</span>{" "}
                <span className="text-text-main">{new Date(selectedDetail.timestamp).toLocaleString()}</span>
              </div>
              <div>
                 <span className="text-text-muted">Provider:</span>{" "}
                 <span className="text-text-main font-medium">{getProviderName(selectedDetail.provider, providerNameCache)}</span>
               </div>
              <div>
                <span className="text-text-muted">Model:</span>{" "}
                <span className="text-text-main font-mono">{selectedDetail.model}</span>
              </div>
              <div>
                <span className="text-text-muted">Status:</span>{" "}
                <span className={cn(
                  "font-medium",
                  selectedDetail.status === "success" ? "text-green-600" : "text-red-600"
                )}>
                  {selectedDetail.status}
                </span>
              </div>
              <div>
                <span className="text-text-muted">Latency:</span>{" "}
                <span className="text-text-main font-mono">
                  TTFT {selectedDetail.latency?.ttft || 0}ms / Total {selectedDetail.latency?.total || 0}ms
                </span>
              </div>
              <div>
                <span className="text-text-muted">Input Tokens:</span>{" "}
                <span className="text-text-main font-mono">
                  {getInputTokens(selectedDetail.tokens).toLocaleString()}
                </span>
              </div>
              {getCachedTokens(selectedDetail.tokens) > 0 && (
                <div>
                  <span className="text-text-muted">Cached Tokens:</span>{" "}
                  <span className="text-text-main font-mono">
                    {getCachedTokens(selectedDetail.tokens).toLocaleString()}
                  </span>
                </div>
              )}
              {getCacheCreationTokens(selectedDetail.tokens) > 0 && (
                <div>
                  <span className="text-text-muted">Cache Creation:</span>{" "}
                  <span className="text-text-main font-mono">
                    {getCacheCreationTokens(selectedDetail.tokens).toLocaleString()}
                  </span>
                </div>
              )}
              <div>
                <span className="text-text-muted">Output Tokens:</span>{" "}
                <span className="text-text-main font-mono">
                  {selectedDetail.tokens?.completion_tokens?.toLocaleString() || 0}
                </span>
              </div>
            </div>

            {selectedDetail.pxpipe && (
              <div className="rounded-md border border-black/5 dark:border-white/5 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="material-symbols-outlined text-[18px] text-text-muted">image</span>
                  <span className="font-semibold text-sm text-text-main">PXPIPE</span>
                  <span className={cn(
                    "text-xs px-2 py-0.5 rounded",
                    selectedDetail.pxpipe.applied
                      ? "bg-green-500/15 text-green-600"
                      : "bg-amber-500/15 text-amber-600"
                  )}>
                    {selectedDetail.pxpipe.applied ? "Activated" : "Skipped"}
                  </span>
                </div>
                {selectedDetail.pxpipe.applied ? (
                  <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                    <div>
                      <span className="text-text-muted block text-xs">Original (est.)</span>
                      <span className="font-mono">{(selectedDetail.pxpipe.tokensBeforeEst || 0).toLocaleString()} tokens</span>
                    </div>
                    <div>
                      <span className="text-text-muted block text-xs">Compressed (est.)</span>
                      <span className="font-mono">{(selectedDetail.pxpipe.tokensAfterEst || 0).toLocaleString()} tokens</span>
                    </div>
                    <div>
                      <span className="text-text-muted block text-xs">Saved</span>
                      <span className="font-mono text-green-600">{selectedDetail.pxpipe.savedPct || 0}%</span>
                    </div>
                    <div>
                      <span className="text-text-muted block text-xs">Images</span>
                      <span className="font-mono">{selectedDetail.pxpipe.imageCount || 0} ({selectedDetail.pxpipe.durationMs || 0}ms)</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-text-muted">
                    Reason: <span className="font-mono">{selectedDetail.pxpipe.reason}</span>
                    {selectedDetail.pxpipe.detail ? ` — ${selectedDetail.pxpipe.detail}` : ""}
                  </p>
                )}
              </div>
            )}

            <Collapse defaultActiveKey={["1", "4"]} items={collapseItems} />
          </div>
        )}
      </Drawer>
    </div>
  );
}
