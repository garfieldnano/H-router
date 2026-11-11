"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Card, Input, Segmented, Statistic, Table, Typography } from "antd";

// Pemakaian Kunci (plan G7) — dedicated page (not an extension of the
// Usage page: nikahub has it as its own sidebar item, and the per-key
// table + per-model breakdown deserves its own screen). Data comes from
// GET /api/usage/by-key, which aggregates the existing usageHistory rows
// per API key — no new table.
const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
  { value: "all", label: "All" },
];

function fmtTime(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("id-ID", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return ts;
  }
}

export default function KeyUsagePage() {
  const [period, setPeriod] = useState("7d");
  const [rows, setRows] = useState([]);
  // Totals start at zero (not null) so the summary cards render on first
  // paint, even before the first fetch resolves over a slow connection
  // (wave 3a browser check saw no totals cards on empty data — they were
  // gated behind `{totals && ...}` while totals was still null mid-load).
  const ZERO_TOTALS = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
  const [totals, setTotals] = useState(ZERO_TOTALS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [expandedKeys, setExpandedKeys] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/usage/by-key?period=${period}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Gagal memuat pemakaian kunci (${res.status})`);
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setTotals(data.totals || ZERO_TOTALS);
      setError("");
    } catch (e) {
      setError(e?.message || "Gagal memuat pemakaian kunci");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { load(); }, [load]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? rows.filter((r) =>
        (r.keyName || "").toLowerCase().includes(q) ||
        (r.maskedKey || "").toLowerCase().includes(q) ||
        (r.memberName || "").toLowerCase().includes(q))
    : rows;

  const columns = [
    {
      title: "Kunci",
      key: "key",
      render: (_v, r) => (
        <div>
          <div className="font-medium">{r.keyName}</div>
          <div className="font-mono text-xs opacity-60">{r.maskedKey || "—"}</div>
          {r.isActive === false && <Typography.Text type="danger" className="text-xs">nonaktif</Typography.Text>}
        </div>
      ),
    },
    { title: "Member", dataIndex: "memberName", key: "member", render: (v) => v || "—" },
    { title: "Request", dataIndex: "requests", key: "requests", align: "right", render: (v) => (v ?? 0).toLocaleString("id-ID") },
    { title: "Token In", dataIndex: "promptTokens", key: "promptTokens", align: "right", render: (v) => (v ?? 0).toLocaleString("id-ID") },
    { title: "Token Out", dataIndex: "completionTokens", key: "completionTokens", align: "right", render: (v) => (v ?? 0).toLocaleString("id-ID") },
    { title: "Biaya", key: "cost", align: "right", render: (_v, r) => `$${(r.cost || 0).toFixed(4)}` },
    { title: "Terakhir dipakai", dataIndex: "lastUsed", key: "lastUsed", render: (v) => fmtTime(v) },
  ];

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-main">Pemakaian Kunci</h1>
          <p className="text-sm text-text-muted">
            Request, token, dan biaya per API key — klik baris untuk rincian per model.
          </p>
        </div>
        <Segmented options={PERIODS} value={period} onChange={setPeriod} />
      </div>

      {error && <Alert type="error" message={error} showIcon />}

      {/* Totals always render (zeros on empty data) — see state init above. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Total request", (totals.requests ?? 0).toLocaleString("id-ID")],
          ["Token input", (totals.promptTokens ?? 0).toLocaleString("id-ID")],
          ["Token output", (totals.completionTokens ?? 0).toLocaleString("id-ID")],
          ["Total biaya", `$${(totals.cost || 0).toFixed(4)}`],
        ].map(([label, value]) => (
          <Card key={label} styles={{ body: { padding: "12px 16px" } }}>
            <Statistic title={label} value={value} />
          </Card>
        ))}
      </div>

      <Input.Search
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Cari kunci / member…"
        allowClear
        style={{ maxWidth: 384 }}
      />

      <Card styles={{ body: { padding: 0 } }}>
        <Table
          columns={columns}
          dataSource={filtered}
          rowKey={(r) => r.keyId || r.maskedKey || "local"}
          loading={loading}
          pagination={false}
          scroll={{ x: 900 }}
          locale={{ emptyText: "Tidak ada kunci untuk filter ini." }}
          expandable={{
            expandedRowKeys: expandedKeys,
            onExpandedRowsChange: setExpandedKeys,
            expandedRowRender: (r) => (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide opacity-60">Per model</div>
                {(r.models || []).length === 0 ? (
                  <p className="text-sm opacity-60">Tidak ada pemakaian pada periode ini.</p>
                ) : (
                  <ul className="mt-1 flex flex-col gap-1 text-sm">
                    {(r.models || []).map((m) => (
                      <li key={`${m.model}-${m.provider}`} className="flex justify-between gap-2">
                        <span>{m.model} <span className="opacity-60">({m.provider})</span></span>
                        <span className="opacity-60">{(m.requests ?? 0).toLocaleString("id-ID")} request</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-xs opacity-60">
                  RPM: {r.rpmLimit ?? "default"} · Batas IP: {r.maxIps ?? "default (3)"}
                </p>
              </div>
            ),
          }}
        />
      </Card>
    </div>
  );
}
