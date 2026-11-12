"use client";

import { useEffect, useRef, useState } from "react";
import { formatLatency, formatLatencyShort, requestLogLatency } from "@/shared/utils/landing.js";

const LOG_PATHS = ["/v1/chat/completions", "/v1/chat/completions", "/v1/messages"];
const LOG_VISIBLE = 4;

// Dashboard preview mockup under the hero, matching the reference landing
// (h-router.web.id): a terminal-style window with the gateway's live
// numbers — active model count from the catalog, median latency measured
// by the parent's /api/health poll, request count in the last 24h from
// /api/health — plus a "latensi per model" bar for the top catalog model
// and a rotating "aliran permintaan" feed. The feed is a simulation built
// from the real catalog model ids and the measured latency (labelled as
// such below the mockup); it is not a live request log — there is no
// public recent-requests endpoint, and the admin usage feed stays behind
// auth. Anything unreachable renders as a dash, never an invented number.
export default function DashboardPreview({ modelCount, models, health, host }) {
  const list = Array.isArray(models) ? models : [];
  const latencyMs = health?.latencyMs ?? null;
  const [rows, setRows] = useState([]);
  const counter = useRef(0);

  const makeRow = (index) => {
    const model = list.length > 0 ? list[index % list.length] : null;
    if (!model) return null;
    return {
      key: index,
      status: 200,
      path: LOG_PATHS[index % LOG_PATHS.length],
      latencyMs: requestLogLatency(latencyMs, index),
      model: model.id,
    };
  };

  // Seed the feed from the catalog (and reseed when the catalog or the
  // measured latency changes, so the rows always use real model ids).
  useEffect(() => {
    const seed = [];
    for (let i = 0; i < Math.min(LOG_VISIBLE, list.length); i++) {
      const row = makeRow(i);
      if (row) seed.push(row);
    }
    counter.current = seed.length;
    setRows(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, latencyMs]);

  // Rotate a new row in every 2.5s so the feed looks alive.
  useEffect(() => {
    if (list.length === 0) return undefined;
    const id = setInterval(() => {
      const row = makeRow(counter.current);
      counter.current += 1;
      if (!row) return;
      setRows((prev) => [row, ...prev].slice(0, LOG_VISIBLE));
    }, 2500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, latencyMs]);

  const topModel = list[0] || null;
  const liveLabel =
    health?.status === "online" ? "live" : health?.status === "offline" ? "offline" : "memeriksa…";
  const liveClass =
    health?.status === "online"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
      : health?.status === "offline"
        ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
        : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400";

  return (
    <section aria-label="Pratinjau dasbor" className="mx-auto mt-14 w-full max-w-6xl px-6">
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
          {/* sidebar — decorative preview nav */}
          <aside aria-hidden="true" className="hidden border-r border-zinc-200 px-3 py-4 dark:border-zinc-800 md:block">
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
          </aside>

          <div className="p-4 md:p-6">
            {/* live stats */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
                  Model aktif
                </p>
                <p className="mt-1 text-2xl font-extrabold tracking-tight md:text-3xl">
                  {typeof modelCount === "number" ? modelCount : "—"}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
                  Latensi median
                </p>
                <p className="mt-1 text-2xl font-extrabold tracking-tight md:text-3xl">
                  {formatLatency(latencyMs)}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
                  Request 24 jam
                </p>
                <p className="mt-1 text-2xl font-extrabold tracking-tight md:text-3xl">
                  {typeof health?.requests24h === "number" ? health.requests24h : "—"}
                </p>
              </div>
            </div>

            {/* latency per model — top catalog model */}
            <div className="mt-6">
              <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
                Latensi per model
              </p>
              {topModel ? (
                <div className="mt-3">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate font-mono text-zinc-700 dark:text-zinc-200">
                      {topModel.id}
                    </span>
                    <span className="shrink-0 font-mono text-zinc-500 dark:text-zinc-400">
                      {formatLatencyShort(latencyMs)}
                    </span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div className="h-2 w-full rounded-full bg-[#05a843] dark:bg-[#05f170]" />
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-sm text-zinc-400">—</p>
              )}
            </div>

            {/* request flow */}
            <div className="mt-6">
              <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
                Aliran permintaan
              </p>
              {rows.length > 0 ? (
                <ul className="mt-3 space-y-2 font-mono text-xs">
                  {rows.map((r) => (
                    <li key={r.key} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                        {r.status}
                      </span>
                      <span className="text-zinc-700 dark:text-zinc-200">{r.path}</span>
                      <span className="text-zinc-400 dark:text-zinc-500">
                        {typeof r.latencyMs === "number" ? `${r.latencyMs}ms` : "—"}
                      </span>
                      <span className="text-zinc-400 dark:text-zinc-500">·</span>
                      <span className="min-w-0 truncate text-zinc-500 dark:text-zinc-400">{r.model}</span>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">ok</span>
                    </li>
                  ))}
                  <li className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
                    <span>POST /v1/chat/completions</span>
                    <span className="inline-block h-3.5 w-[7px] animate-pulse bg-emerald-600 dark:bg-emerald-400" />
                  </li>
                </ul>
              ) : (
                <p className="mt-3 text-sm text-zinc-400">Belum ada model di katalog.</p>
              )}
            </div>
          </div>
        </div>
      </div>
      <p className="mt-3 text-center text-xs text-zinc-400 dark:text-zinc-500">
        Pratinjau dasbor — jumlah model, latensi, dan request 24 jam dibaca langsung dari gateway ini; alur
        permintaan adalah simulasi dari katalog di atas.
      </p>
    </section>
  );
}
