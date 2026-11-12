"use client";

import { useEffect, useState } from "react";
import {
  fetchWithTimeout,
  formatLatency,
  formatLatencyShort,
  formatRelativeTime,
  formatTokenCount,
  normalizeRecentRequests,
  resolveModelBrand,
} from "@/shared/utils/landing.js";
import { LANDING_BRANDS } from "@/shared/constants/landing.js";

const FLOW_POLL_MS = 5000;
const FLOW_TIMEOUT_MS = 5000;

// Dashboard preview mockup under the hero, matching the reference landing
// (h-router.web.id): a terminal-style window with the gateway's live
// numbers — active model count from the catalog, median latency measured
// by the parent's /api/health poll, request and token counts in the last
// 24h from /api/health — plus a "latensi per model" bar for the top
// catalog model and a real "aliran permintaan" feed. The feed reads
// /api/public/recent-requests (the last 4 real gateway requests in the
// last 24h, newest first) and polls every 5s, so it shows what actually
// hit this gateway — never simulated rows. When there is no traffic in
// the window it says so instead of inventing entries; a failed fetch
// renders a dash. Anything unreachable renders as a dash, never an
// invented number.
export default function DashboardPreview({ modelCount, models, health, host }) {
  const list = Array.isArray(models) ? models : [];
  const latencyMs = health?.latencyMs ?? null;
  const [requests, setRequests] = useState(null);

  // Real request flow: fetch the last real requests, then poll so new
  // traffic appears without a reload. A failed fetch leaves the previous
  // rows in place (null only before the first successful load).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetchWithTimeout("/api/public/recent-requests", { timeoutMs: FLOW_TIMEOUT_MS });
        const rows = normalizeRecentRequests(await res.json());
        if (!cancelled && rows !== null) setRequests(rows);
      } catch {}
    };
    load();
    const id = setInterval(load, FLOW_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const topModel = list[0] || null;
  // The latency line never shows the upstream provider prefix ("coarena/…")
  // — the selling page must not reveal where the model is sourced from.
  // Show the bare model id, the same form the request-flow rows use.
  const topModelLabel = topModel ? topModel.id.split("/").pop() : null;
  // The latency bar is scaled against a 1000 ms max, so a ~200 ms median
  // reads as a short bar instead of a full one. Only one latency value
  // exists (the /api/health round-trip), so there is exactly one row —
  // per-model bars would invent numbers that do not exist.
  const LATENCY_SCALE_MS = 1000;
  const latencyPct =
    latencyMs === null ? 0 : Math.min(100, Math.max(4, Math.round((latencyMs / LATENCY_SCALE_MS) * 100)));
  const liveLabel =
    health?.status === "online" ? "live" : health?.status === "offline" ? "offline" : "memeriksa…";
  const liveClass =
    health?.status === "online"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
      : health?.status === "offline"
        ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
        : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400";

  return (
    <section aria-label="Pratinjau dasbor" className="mx-auto mt-10 w-full max-w-6xl px-6">
      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
        {/* window chrome */}
        <div className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <span className="flex gap-1.5" aria-hidden="true">
            <span className="size-3 rounded-full bg-[#ff5f57]" />
            <span className="size-3 rounded-full bg-[#febc2e]" />
            <span className="size-3 rounded-full bg-[#28c840]" />
          </span>
          <span className="font-mono text-sm text-zinc-600 dark:text-zinc-300">{host}</span>
          <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-bold ${liveClass}`}>
            {liveLabel}
          </span>
        </div>

        <div className="grid md:grid-cols-[180px_1fr]">
          {/* sidebar — decorative preview nav. A footer pins the bottom so
              the column does not end far above the window's bottom edge. */}
          <aside aria-hidden="true" className="hidden flex-col justify-between border-r border-zinc-200 dark:border-zinc-800 md:flex">
            <div className="px-3 py-4">
              {["Ringkasan", "Playground", "Model", "Kunci", "Log"].map((item, i) => (
                <span
                  key={item}
                  className={`mb-1 block rounded-lg px-3 py-2 text-sm font-medium ${
                    i === 0
                      ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white"
                      : "text-zinc-500 dark:text-zinc-400"
                  }`}
                >
                  {item}
                </span>
              ))}
            </div>
            <div className="border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
              <span className="flex items-center gap-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                <span className="h-1.5 w-1.5 rounded-full bg-[#05a843] dark:bg-[#05f170]" />
                H-router
              </span>
            </div>
          </aside>

          <div className="p-4 md:p-6">
            {/* live stats — equal columns, tabular figures, and the same
                compact count format for both 24h numbers so the units read
                consistently ("1.1 rb" / "23.97 jt" instead of raw vs compact). */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-500">
                  Model aktif
                </p>
                <p className="mt-1 text-2xl font-extrabold tabular-nums tracking-tight md:text-3xl">
                  {typeof modelCount === "number" ? modelCount : "—"}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-500">
                  Latensi median
                </p>
                <p className="mt-1 text-2xl font-extrabold tabular-nums tracking-tight md:text-3xl">
                  {formatLatency(latencyMs)}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-500">
                  Request 24 jam
                </p>
                <p className="mt-1 text-2xl font-extrabold tabular-nums tracking-tight md:text-3xl">
                  {typeof health?.requests24h === "number" ? formatTokenCount(health.requests24h) : "—"}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-500">
                  Token 24 jam
                </p>
                <p className="mt-1 text-2xl font-extrabold tabular-nums tracking-tight md:text-3xl">
                  {formatTokenCount(health?.tokens24h)}
                </p>
              </div>
            </div>

            {/* latency per model — top catalog model */}
            <div className="mt-6">
              <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-500">
                Latensi per model
              </p>
              {topModel ? (
                <div className="mt-3">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      {(() => {
                        const brand = resolveModelBrand({ id: topModel.id, ownedBy: topModel.ownedBy, brands: LANDING_BRANDS });
                        return brand?.logo ? (
                          <img src={brand.logo} alt={brand.name} width={18} height={18} loading="lazy" className="h-[18px] w-[18px] shrink-0" />
                        ) : null;
                      })()}
                      <span className="min-w-0 truncate font-mono text-zinc-700 dark:text-zinc-200">
                        {topModelLabel}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-zinc-500 dark:text-zinc-400">
                      {formatLatencyShort(latencyMs)}
                    </span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div
                      className="h-2 rounded-full bg-[#05a843] dark:bg-[#05f170]"
                      style={{ width: `${latencyPct}%` }}
                    />
                  </div>
                  <div className="mt-1 flex justify-between font-mono text-[10px] text-zinc-500 dark:text-zinc-500">
                    <span>0</span>
                    <span>{`${LATENCY_SCALE_MS} ms`}</span>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-sm text-zinc-500">—</p>
              )}
            </div>

            {/* request flow — real recent requests, newest first */}
            <div className="mt-6">
              <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-500">
                Aliran permintaan
              </p>
              {requests === null ? (
                <p className="mt-3 font-mono text-xs text-zinc-500">—</p>
              ) : requests.length === 0 ? (
                <p className="mt-3 font-mono text-xs text-zinc-500">
                  Belum ada request dalam 24 jam terakhir — kirim request pertama lewat /v1/chat/completions.
                </p>
              ) : (
                <ul className="mt-3 space-y-2 font-mono text-xs">
                  {requests.map((r) => (
                    <li key={`${r.timestamp}-${r.model}`} className="flex items-center gap-3">
                      <span
                        className={`w-9 shrink-0 rounded px-1.5 py-0.5 text-center font-bold ${
                          r.status === "ok"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                            : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                        }`}
                      >
                        {r.status}
                      </span>
                      <span className="shrink-0 text-zinc-700 dark:text-zinc-200">{r.endpoint}</span>
                      <span className="w-28 shrink-0 text-right tabular-nums text-zinc-500 dark:text-zinc-500">
                        {formatTokenCount(r.tokens)} token
                      </span>
                      <span className="flex min-w-0 shrink-0 items-center gap-2.5">
                        {(() => {
                          const brand = resolveModelBrand({ id: r.model, ownedBy: "", brands: LANDING_BRANDS });
                          return brand?.logo ? (
                            <img src={brand.logo} alt={brand.name} width={16} height={16} loading="lazy" className="h-4 w-4 shrink-0" />
                          ) : null;
                        })()}
                        <span className="max-w-60 truncate text-zinc-500 dark:text-zinc-400">{r.model}</span>
                      </span>
                      {/* The gap between the model name and the timestamp
                          was empty — fill it with the same calm traveling
                          signal the catalog rows use (thin line, one soft
                          green glow gliding left to right). */}
                      <span className="relative h-[2px] min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" aria-hidden="true">
                        <span className="animate-signal-travel absolute top-0 h-full w-24 rounded-full bg-gradient-to-r from-transparent via-[#05a843] to-transparent dark:via-[#05f170]" />
                      </span>
                      <span className="w-20 shrink-0 text-right text-zinc-500 dark:text-zinc-500">
                        {formatRelativeTime(r.timestamp)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
      <p className="mt-3 text-center text-xs text-zinc-500 dark:text-zinc-500">
        Pratinjau dasbor — jumlah model, latensi, request dan token 24 jam, serta aliran permintaan dibaca
        langsung dari gateway ini (request beneran 24 jam terakhir, diperbarui tiap 5 detik).
      </p>
    </section>
  );
}
