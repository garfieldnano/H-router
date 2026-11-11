"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchWithTimeout, formatLatency } from "@/shared/utils/landing.js";
import { LANDING_CONFIG } from "@/shared/constants/landing.js";

// Live status panel. Shows ONLY real data, measured here:
// - liveness + latency: GET /api/health (public, { ok: true })
// - model count: the /v1/models result fetched by the parent page
// - base URL: the landing config constant
// Anything unreachable renders as a dash — never an invented number.
export default function StatusPanel({ modelCount, modelsSource }) {
  const [health, setHealth] = useState({ status: "checking", latencyMs: null, updatedAt: null });

  // Hard 10s timeout: a hung health check must never leave the panel on
  // "Memeriksa…" forever — on timeout it renders Offline and retries on
  // the next 30s tick.
  const check = useCallback(async () => {
    const t0 = performance.now();
    try {
      const res = await fetchWithTimeout("/api/health", { timeoutMs: 10000 });
      const ms = performance.now() - t0;
      const json = await res.json().catch(() => ({}));
      setHealth({
        status: res.ok && json.ok === true ? "online" : "offline",
        latencyMs: res.ok ? ms : null,
        updatedAt: new Date(),
      });
    } catch {
      setHealth({ status: "offline", latencyMs: null, updatedAt: new Date() });
    }
  }, []);

  useEffect(() => {
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, [check]);

  const statusLabel =
    health.status === "online" ? "Online" : health.status === "offline" ? "Offline" : "Memeriksa…";
  const statusDot =
    health.status === "online"
      ? "bg-[#05f170]"
      : health.status === "offline"
        ? "bg-red-500"
        : "bg-zinc-400";
  const host = LANDING_CONFIG.baseUrl.replace(/^https?:\/\//, "");

  return (
    <section aria-label="Status gateway" className="mx-auto mt-10 w-full max-w-6xl px-6">
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className={`inline-block size-2.5 rounded-full ${statusDot}`} />
            <span className="text-sm font-semibold text-zinc-900 dark:text-white">
              {host} · {statusLabel}
            </span>
          </div>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {health.updatedAt ? `Diperbarui ${health.updatedAt.toLocaleTimeString("id-ID")}` : "Memeriksa status…"}
          </span>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <dt className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Status</dt>
            <dd className="mt-1 text-lg font-bold text-zinc-900 dark:text-white">{statusLabel}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Model</dt>
            <dd className="mt-1 text-lg font-bold text-zinc-900 dark:text-white">
              {typeof modelCount === "number" ? `${modelCount} model` : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Latensi</dt>
            <dd className="mt-1 text-lg font-bold text-zinc-900 dark:text-white">{formatLatency(health.latencyMs)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Base URL</dt>
            <dd className="mt-1 truncate font-mono text-sm font-semibold text-zinc-900 dark:text-white">{host}</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
          Status dibaca langsung dari <code className="font-mono">/api/health</code>
          {modelsSource === "live" ? (
            <>; jumlah model dari <code className="font-mono">/v1/models</code> gateway ini</>
          ) : modelsSource === "fallback" ? (
            <>; daftar model dari konfigurasi cadangan (gateway tidak mengembalikan daftar tanpa kunci)</>
          ) : (
            <>; latensi adalah waktu respons permintaan health barusan</>
          )}
          .
        </p>
      </div>
    </section>
  );
}
