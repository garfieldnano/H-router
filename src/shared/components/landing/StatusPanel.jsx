"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Card, Statistic, Typography } from "antd";
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
  const badgeStatus = health.status === "online" ? "success" : health.status === "offline" ? "error" : "default";
  const host = LANDING_CONFIG.baseUrl.replace(/^https?:\/\//, "");

  return (
    <section aria-label="Status gateway" className="mx-auto mt-10 w-full max-w-6xl px-6">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Badge
            status={badgeStatus}
            text={
              <Typography.Text strong>
                {host} · {statusLabel}
              </Typography.Text>
            }
          />
          <Typography.Text type="secondary" className="text-xs">
            {health.updatedAt ? `Diperbarui ${health.updatedAt.toLocaleTimeString("id-ID")}` : "Memeriksa status…"}
          </Typography.Text>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Statistic title="Status" value={statusLabel} valueStyle={{ fontSize: 18 }} />
          <Statistic
            title="Model"
            value={typeof modelCount === "number" ? `${modelCount} model` : "—"}
            valueStyle={{ fontSize: 18 }}
          />
          <Statistic title="Latensi" value={formatLatency(health.latencyMs)} valueStyle={{ fontSize: 18 }} />
          <Statistic title="Base URL" value={host} valueStyle={{ fontSize: 14 }} />
        </div>
        <Typography.Text type="secondary" className="mt-4 block text-xs">
          Status dibaca langsung dari <Typography.Text code>/api/health</Typography.Text>
          {modelsSource === "live" ? (
            <>
              ; jumlah model dari <Typography.Text code>/v1/models</Typography.Text> gateway ini
            </>
          ) : modelsSource === "fallback" ? (
            <>; daftar model dari konfigurasi cadangan (gateway tidak mengembalikan daftar tanpa kunci)</>
          ) : (
            <>; latensi adalah waktu respons permintaan health barusan</>
          )}
          .
        </Typography.Text>
      </Card>
    </section>
  );
}
