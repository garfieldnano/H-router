"use client";

import { useEffect, useState } from "react";
import { Card, Table, Typography } from "antd";
import {
  LatencyBar,
  Panel,
  StatCard,
} from "@/shared/components/dashboard-cards";

// Member Quota Tracker (read-only): the member's OWN quota only — per-key
// RPM limit + current-minute usage and IP cap + active IPs, plus 30-day
// usage totals. Data comes from the already member-scoped /api/keys
// (rate/ip attached server-side) and /api/usage/stats. No admin controls,
// no other member's data, no provider-global quotas.
function maskKey(key) {
  if (!key || key.length <= 18) return key || "-";
  return `${key.slice(0, 14)}…${key.slice(-4)}`;
}

const columns = [
  {
    title: "Kunci",
    dataIndex: "key",
    key: "key",
    render: (_v, k) => (
      <div>
        <div className="font-medium">{k.name || "-"}</div>
        <div className="font-mono hcard-mono text-xs opacity-60">{maskKey(k.key)}</div>
      </div>
    ),
  },
  {
    title: "Batas RPM",
    dataIndex: "rpm",
    key: "rpm",
    render: (_v, k) =>
      `${k.rate?.limit ?? k.rpmLimit ?? "-"}${k.rate?.packageName ? ` (${k.rate.packageName})` : ""}`,
  },
  {
    title: "Dipakai (menit ini)",
    dataIndex: "used",
    key: "used",
    render: (_v, k) => k.rate?.used ?? 0,
  },
  {
    title: "Sisa",
    dataIndex: "remaining",
    key: "remaining",
    render: (_v, k) => k.rate?.remaining ?? "-",
  },
  {
    title: "IP aktif / batas",
    dataIndex: "ip",
    key: "ip",
    render: (_v, k) => (k.ip ? `${k.ip.activeCount} / ${k.ip.cap}` : "-"),
  },
];

export default function MemberQuota() {
  const [keys, setKeys] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [keysRes, statsRes] = await Promise.all([
          fetch("/api/keys", { cache: "no-store" }),
          fetch("/api/usage/stats?period=30d", { cache: "no-store" }),
        ]);
        if (cancelled) return;
        if (keysRes.ok) {
          const data = await keysRes.json();
          setKeys(data.keys || []);
        }
        if (statsRes.ok) setStats(await statsRes.json());
      } catch {
        if (!cancelled) setError("Gagal memuat kuota.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <Typography.Text type="danger">{error}</Typography.Text>;
  if (keys === null) return <Typography.Text type="secondary">Memuat kuota…</Typography.Text>;

  // Quota bars in the latency-bar language, from the same real per-key
  // rate/ip values the table shows. Only keys with a known limit render a
  // bar (limit unknown → no bar, never a guessed value).
  const rpmBars = (keys || []).filter((k) => k.rate?.limit != null);
  const maxRpm = rpmBars.reduce((m, k) => Math.max(m, k.rate?.limit || 0), 0);
  const ipBars = (keys || []).filter((k) => k.ip?.cap != null);
  const maxIp = ipBars.reduce((m, k) => Math.max(m, k.ip?.cap || 0), 0);

  return (
    <div className="flex min-w-0 flex-col gap-4 px-1 sm:px-0">
      <div>
        <Typography.Title level={2} style={{ margin: 0 }}>
          Quota Tracker
        </Typography.Title>
        <Typography.Text type="secondary">
          Kuota kunci API kamu — batas RPM &amp; IP, plus pemakaian 30 hari.
        </Typography.Text>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <StatCard
          label="Request (30 hari)"
          value={(stats?.totalRequests ?? 0).toLocaleString("id-ID")}
        />
        <StatCard
          label="Biaya (30 hari)"
          value={`$${(stats?.totalCost ?? 0).toFixed(4)}`}
        />
      </div>

      {(rpmBars.length > 0 || ipBars.length > 0) && (
        <Panel title="Pemakaian kuota" right="per kunci">
          {rpmBars.map((k) => (
            <LatencyBar
              key={`rpm-${k.id}`}
              name={k.name || "Unnamed key"}
              badge={(k.name || "?").slice(0, 2).toUpperCase()}
              latencyMs={k.rate?.used ?? 0}
              maxMs={maxRpm}
              display={`${k.rate?.used ?? 0}/${k.rate?.limit ?? "-"} rpm`}
            />
          ))}
          {ipBars.map((k) => (
            <LatencyBar
              key={`ip-${k.id}`}
              name={`${k.name || "Unnamed key"} — IP`}
              badge="IP"
              latencyMs={k.ip?.activeCount ?? 0}
              maxMs={maxIp}
              display={`${k.ip?.activeCount ?? 0}/${k.ip?.cap ?? "-"} IP`}
            />
          ))}
        </Panel>
      )}

      {keys.length === 0 ? (
        <Typography.Text type="secondary">
          Belum ada kunci API. Minta admin untuk menetapkan kunci ke akun Anda.
        </Typography.Text>
      ) : (
        <Card styles={{ body: { padding: 0 } }} className="hcard-panel">
          <Table
            columns={columns}
            dataSource={keys}
            rowKey="id"
            pagination={false}
            scroll={{ x: 640 }}
          />
        </Card>
      )}
      <Typography.Text type="secondary" className="text-xs">
        Kuota dihitung per kunci. Batas RPM dan IP diatur oleh admin — hubungi admin bila butuh penyesuaian.
      </Typography.Text>
    </div>
  );
}
