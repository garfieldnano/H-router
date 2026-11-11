"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, Switch, Table, Tag } from "antd";

function parseLog(log) {
  const parts = log.split(" | ");
  if (parts.length < 7) return null;
  const status = parts[6];
  return {
    key: log,
    datetime: parts[0],
    model: parts[1],
    provider: parts[2],
    account: parts[3],
    inTokens: parts[4],
    outTokens: parts[5],
    status,
    isPending: status.includes("PENDING"),
    isFailed: status.includes("FAILED"),
    isSuccess: status.includes("OK"),
  };
}

const columns = [
  { title: "DateTime", dataIndex: "datetime", key: "datetime" },
  {
    title: "Model",
    dataIndex: "model",
    key: "model",
    render: (model) => <span className="font-medium">{model}</span>,
  },
  {
    title: "Provider",
    dataIndex: "provider",
    key: "provider",
    render: (provider) => <Tag>{provider}</Tag>,
  },
  {
    title: "Account",
    dataIndex: "account",
    key: "account",
    ellipsis: true,
    render: (account) => (
      <span className="truncate max-w-[150px] block" title={account}>
        {account}
      </span>
    ),
  },
  {
    title: "In",
    dataIndex: "inTokens",
    key: "inTokens",
    align: "right",
    render: (v) => <span className="text-primary">{v}</span>,
  },
  {
    title: "Out",
    dataIndex: "outTokens",
    key: "outTokens",
    align: "right",
    render: (v) => <span className="text-success">{v}</span>,
  },
  {
    title: "Status",
    dataIndex: "status",
    key: "status",
    render: (_, r) => (
      <span
        className={`font-bold ${
          r.isSuccess ? "text-success" : r.isFailed ? "text-error" : "text-primary animate-pulse"
        }`}
      >
        {r.status}
      </span>
    ),
  },
];

export default function RequestLogger() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    fetchLogs();
  }, []);

  useEffect(() => {
    let interval;
    if (autoRefresh) {
      interval = setInterval(() => {
        fetchLogs(false);
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const fetchLogs = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const res = await fetch("/api/usage/request-logs");
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (error) {
      console.error("Failed to fetch logs:", error);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const dataSource = useMemo(
    () =>
      logs
        .map((log, i) => {
          const row = parseLog(log);
          return row ? { ...row, key: `${i}-${log.slice(0, 32)}` } : null;
        })
        .filter(Boolean),
    [logs]
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Request Logs</h2>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-text-muted flex items-center gap-2 cursor-pointer">
            <span>Auto Refresh (3s)</span>
            <Switch checked={autoRefresh} onChange={setAutoRefresh} size="small" />
          </label>
        </div>
      </div>

      <Card styles={{ body: { padding: 0 } }} className="overflow-hidden">
        <Table
          columns={columns}
          dataSource={dataSource}
          rowKey="key"
          loading={loading && logs.length === 0}
          pagination={false}
          size="small"
          scroll={{ x: 800, y: 560 }}
          locale={{ emptyText: "No logs recorded yet." }}
          rowClassName={(r) => (r.isPending ? "bg-primary/5" : "")}
        />
      </Card>
      <div className="text-[10px] text-text-muted italic">
        Logs are loaded from the request history database.
      </div>
    </div>
  );
}
