"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

function statusClass(status) {
  const s = String(status || "").toLowerCase();
  if (s === "ok" || s === "success" || s.startsWith("200")) return "text-success";
  if (s.startsWith("4") || s.includes("fail") || s.includes("error")) return "text-error";
  return "text-text-muted";
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
          <span className={`rounded-lg border px-3 py-2 text-sm ${transport === "sse" ? "border-success/40 bg-success/10 text-success" : "border-warning/40 bg-warning/10 text-warning"}`}>
            {transport === "sse" ? "● STREAM AKTIF" : "◌ POLLING"}
          </span>
          <button
            onClick={() => setPaused((p) => !p)}
            className="rounded-lg border border-border-subtle px-3 py-2 text-sm text-text-main hover:bg-bg-subtle"
          >
            {paused ? `▶ Lanjutkan${pendingCount > 0 ? ` (+${pendingCount} baru)` : ""}` : "⏸ Jeda"}
          </button>
        </div>
      </div>

      {error && transport === "polling" && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">{error}</div>
      )}
      <p className="text-xs text-text-muted">
        {secondsAgo === null ? "Menunggu data pertama…" : `Terakhir diperbarui ${secondsAgo} dtk lalu`}
        {paused && pendingCount > 0 ? ` · ${pendingCount} permintaan baru menunggu` : ""}
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Permintaan hari ini", fmtNum(stats?.totalRequests), "text-text-main"],
          ["Sedang berjalan", fmtNum(inFlight), inFlight > 0 ? "text-warning" : "text-success"],
          ["Total token hari ini", fmtNum(totalTokens), "text-text-main"],
          ["Biaya hari ini", fmtCost(stats?.totalCost), "text-text-main"],
        ].map(([label, value, cls]) => (
          <div key={label} className="rounded-lg border border-border-subtle bg-surface p-3">
            <div className={`text-2xl font-semibold ${cls}`}>{value}</div>
            <div className="text-xs text-text-muted">{label}</div>
          </div>
        ))}
      </div>

      {active.length > 0 && (
        <div className="rounded-lg border border-border-subtle bg-surface p-3">
          <h2 className="mb-2 text-sm font-semibold text-text-main">Sedang Berjalan ({inFlight})</h2>
          <div className="flex flex-col gap-1">
            {active.map((a, i) => (
              <div key={`${a.model}-${a.account}-${i}`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-text-main">{a.model} <span className="text-text-muted">({a.provider} · {a.account})</span></span>
                <span className="font-medium text-warning">×{a.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {active.length === 0 && (
        <p className="text-sm text-text-muted">Menganggur. Belum ada permintaan yang sedang berjalan.</p>
      )}

      <div className="rounded-lg border border-border-subtle bg-surface p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-text-main">Feed Permintaan</h2>
          <span className="text-xs text-text-muted">
            {feed.length} terbaru · {feedOk} OK · {feedFail} gagal
          </span>
        </div>
        {feed.length === 0 ? (
          <p className="text-sm text-text-muted">Belum ada permintaan hari ini.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-left text-text-muted">
                  <th className="px-3 py-2">Waktu</th>
                  <th className="px-3 py-2">Kunci</th>
                  <th className="px-3 py-2">Model</th>
                  <th className="px-3 py-2">Provider</th>
                  <th className="px-3 py-2 text-right">Token</th>
                  <th className="px-3 py-2 text-right">Biaya</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {feed.map((r, i) => (
                  <tr key={`${r.timestamp}-${r.model}-${i}`} className="border-b border-border-subtle last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 text-text-muted">{fmtTime(r.timestamp)}</td>
                    <td className="px-3 py-2 font-mono text-xs text-text-main">{r.apiKey || "—"}</td>
                    <td className="px-3 py-2 text-text-main">{r.model}</td>
                    <td className="px-3 py-2 text-text-muted">{r.provider || "—"}</td>
                    <td className="px-3 py-2 text-right text-text-main">{fmtNum((r.promptTokens || 0) + (r.completionTokens || 0))}</td>
                    <td className="px-3 py-2 text-right text-text-muted">{fmtCost(r.cost)}</td>
                    <td className={`px-3 py-2 ${statusClass(r.status)}`}>{r.status || "ok"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
