"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Statistic, Table, Tag } from "antd";

// Live Traffic (plan G7) — real-time gateway traffic monitor.
//
// Transport: the EXISTING SSE stream /api/usage/stream?period=today
// (same stream UsageStats uses, plus the period the traffic cards need).
// No new transport was built: the stream already pushes full stats
// (totals, activeRequests, recentRequests) on every usage save. When the
// EventSource fails, the page falls back to polling /api/usage/stats
// every 5s and says so in the status line.
//
// Cards: requests today / in-flight / total tokens today / cost today.
// Feed: the 20 most recent requests (time, key, model, provider, tokens,
// cost, status). Pause freezes the feed and counts arrivals as "+N baru".
function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString("id-ID", { hour12: false });
  } catch {
    return ts || "-";
  }
}

function fmtNum(n) {
  return (n ?? 0).toLocaleString("id-ID");
}

function fmtCost(c) {
  return `$${(c ?? 0).toFixed(4)}`;
}

function statusTagColor(status) {
  const s = String(status || "").toLowerCase();
  if (s === "ok" || s === "success" || s.startsWith("200")) return "success";
  if (s.startsWith("4") || s.includes("fail") || s.includes("error")) return "error";
  return "default";
}

export default function TrafficPage() {
  const [stats, setStats] = useState(null);
  const [paused, setPaused] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [transport, setTransport] = useState("sse"); // "sse" | "polling"
  const [lastUpdate, setLastUpdate] = useState(null);
  const [error, setError] = useState("");
  const pausedRef = useRef(false);
  const latestRef = useRef(null);
  const pollRef = useRef(null);

  const applyStats = useCallback((data) => {
    if (!data || typeof data !== "object") return;
    if (pausedRef.current) {
      // Freeze the feed, but remember the newest snapshot so resuming
      // shows current data immediately instead of waiting for the next push.
      latestRef.current = data;
      setPendingCount((n) => n + 1);
      return;
    }
    setStats(data);
    setLastUpdate(Date.now());
  }, []);

  const loadRest = useCallback(async () => {
    try {
      const res = await fetch("/api/usage/stats?period=today");
      const data = await res.json().catch(() => null);
      if (res.ok && data) applyStats(data);
    } catch {
      // SSE retry (below) is the primary recovery path; polling is best-effort.
    }
  }, [applyStats]);

  useEffect(() => {
    pausedRef.current = paused;
    if (!paused) {
      setPendingCount(0);
      if (latestRef.current) {
        setStats(latestRef.current);
        setLastUpdate(Date.now());
        latestRef.current = null;
      }
    }
  }, [paused]);

  useEffect(() => {
    const es = new EventSource("/api/usage/stream?period=today");
    es.onmessage = (e) => {
      try {
        applyStats(JSON.parse(e.data));
      } catch {
        // Ignore a malformed frame; the next push replaces it.
      }
    };
    es.onerror = () => {
      // Fall back to REST polling until the stream recovers (a new
      // EventSource is opened on the next mount; polling keeps the page
      // live in the meantime).
      setTransport("polling");
      setError("Stream SSE terputus — beralih ke polling 5 detik.");
    };
    return () => es.close();
  }, [applyStats]);

  useEffect(() => {
    if (transport !== "polling") return undefined;
    loadRest();
    pollRef.current = setInterval(loadRest, 5000);
    return () => clearInterval(pollRef.current);
  }, [transport, loadRest]);

  const feed = Array.isArray(stats?.recentRequests) ? stats.recentRequests : [];
  const active = Array.isArray(stats?.activeRequests) ? stats.activeRequests : [];
  const inFlight = active.reduce((n, a) => n + (a.count || 0), 0);
  const totalTokens = (stats?.totalPromptTokens || 0) + (stats?.totalCompletionTokens || 0);
  const feedOk = feed.filter((r) => String(r.status || "").toLowerCase() === "ok" || String(r.status || "").toLowerCase() === "success").length;
  const feedFail = feed.length - feedOk;
  const secondsAgo = lastUpdate ? Math.max(0, Math.round((Date.now() - lastUpdate) / 1000)) : null;

  const columns = [
    { title: "Waktu", dataIndex: "timestamp", key: "time", render: (ts) => fmtTime(ts) },
    { title: "Kunci", dataIndex: "apiKey", key: "key", render: (v) => <span className="font-mono text-xs">{v || "—"}</span> },
    { title: "Model", dataIndex: "model", key: "model" },
    { title: "Provider", dataIndex: "provider", key: "provider", render: (v) => v || "—" },
    { title: "Token", key: "tokens", align: "right", render: (_v, r) => fmtNum((r.promptTokens || 0) + (r.completionTokens || 0)) },
    { title: "Biaya", dataIndex: "cost", key: "cost", align: "right", render: (c) => fmtCost(c) },
    { title: "Status", dataIndex: "status", key: "status", render: (s) => <Tag color={statusTagColor(s)}>{s || "ok"}</Tag> },
  ];

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-main">Trafik Langsung</h1>
          <p className="text-sm text-text-muted">
            Pemantau permintaan real-time — permintaan yang sedang berjalan dan feed langsung hari ini.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tag color={transport === "sse" ? "success" : "warning"}>
            {transport === "sse" ? "● STREAM AKTIF" : "◌ POLLING"}
          </Tag>
          <Button onClick={() => setPaused((p) => !p)}>
            {paused ? `▶ Lanjutkan${pendingCount > 0 ? ` (+${pendingCount} baru)` : ""}` : "⏸ Jeda"}
          </Button>
        </div>
      </div>

      {error && transport === "polling" && (
        <Alert type="warning" message={error} showIcon />
      )}
      <p className="text-xs text-text-muted">
        {secondsAgo === null ? "Menunggu data pertama…" : `Terakhir diperbarui ${secondsAgo} dtk lalu`}
        {paused && pendingCount > 0 ? ` · ${pendingCount} permintaan baru menunggu` : ""}
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Permintaan hari ini", fmtNum(stats?.totalRequests)],
          ["Sedang berjalan", fmtNum(inFlight)],
          ["Total token hari ini", fmtNum(totalTokens)],
          ["Biaya hari ini", fmtCost(stats?.totalCost)],
        ].map(([label, value]) => (
          <Card key={label} styles={{ body: { padding: "12px 16px" } }}>
            <Statistic title={label} value={value} />
          </Card>
        ))}
      </div>

      {active.length > 0 ? (
        <Card title={`Sedang Berjalan (${inFlight})`} styles={{ body: { padding: "12px 16px" } }}>
          <div className="flex flex-col gap-1">
            {active.map((a, i) => (
              <div key={`${a.model}-${a.account}-${i}`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-text-main">{a.model} <span className="text-text-muted">({a.provider} · {a.account})</span></span>
                <span className="font-medium text-warning">×{a.count}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <p className="text-sm text-text-muted">Menganggur. Belum ada permintaan yang sedang berjalan.</p>
      )}

      <Card
        title="Feed Permintaan"
        extra={<span className="text-xs text-text-muted">{feed.length} terbaru · {feedOk} OK · {feedFail} gagal</span>}
        styles={{ body: { padding: 0 } }}
      >
        <Table
          columns={columns}
          dataSource={feed}
          rowKey={(r, i) => `${r.timestamp}-${r.model}-${i}`}
          pagination={false}
          scroll={{ x: 800 }}
          locale={{ emptyText: "Belum ada permintaan hari ini." }}
        />
      </Card>
    </div>
  );
}
