"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Input, Pagination, Select, Table, Tag, Typography } from "antd";

// Conversations (plan G7) — conversation log viewer built on the EXISTING
// requestDetails + usageHistory stores. NOT basic-chat (that is only a
// chat UI). No conversations table was created: each stored request is one
// turn, and the detail view renders its messages + assistant reply.
//
// Anti-leak (plan #2): the stored bodies already had any injected live
// prompt replaced by the placeholder at save time; the detail API returns
// extracted turns only — never raw headers or raw request/response bodies.
// Admin-only: the dashboard guard redirects members, and the APIs return
// 403 for member sessions.
function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleString("id-ID", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return ts || "-";
  }
}

const ROLE_TAG_COLOR = {
  system: "warning",
  user: "default",
  assistant: "success",
  tool: "default",
};

export default function ConversationsPage() {
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, totalItems: 0, totalPages: 1 });
  const [observabilityEnabled, setObservabilityEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [status, setStatus] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (provider.trim()) params.set("provider", provider.trim());
      if (model.trim()) params.set("model", model.trim());
      if (status) params.set("status", status);
      const res = await fetch(`/api/usage/request-details?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Gagal memuat percakapan (${res.status})`);
      setRows(Array.isArray(data.details) ? data.details : []);
      setPagination(data.pagination || { page, pageSize: 20, totalItems: 0, totalPages: 1 });
      setObservabilityEnabled(data.observabilityEnabled !== false);
      setError("");
    } catch (e) {
      setError(e?.message || "Gagal memuat percakapan");
    } finally {
      setLoading(false);
    }
  }, [provider, model, status]);

  useEffect(() => { load(1); }, [load]);

  const openDetail = async (id) => {
    setSelectedId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Gagal memuat detail (${res.status})`);
      setDetail(data);
    } catch (e) {
      setDetail({ error: e?.message || "Gagal memuat detail" });
    } finally {
      setDetailLoading(false);
    }
  };

  const columns = [
    { title: "Waktu", dataIndex: "timestamp", key: "time", render: (ts) => fmtTime(ts) },
    { title: "Model", dataIndex: "model", key: "model", render: (v) => v || "—" },
    { title: "Provider", dataIndex: "provider", key: "provider", render: (v) => v || "—" },
    {
      title: "Token", key: "tokens", align: "right",
      render: (_v, d) => (((d.tokens?.prompt_tokens || 0) + (d.tokens?.completion_tokens || 0))).toLocaleString("id-ID"),
    },
    { title: "Latensi", key: "latency", align: "right", render: (_v, d) => (d.latency?.total ? `${d.latency.total} ms` : "—") },
    {
      title: "Status", dataIndex: "status", key: "status",
      render: (s) => <Tag color={s === "success" ? "success" : "error"}>{s || "—"}</Tag>,
    },
    { title: "Live prompt", key: "live", render: (_v, d) => (d.live_injected ? "⭐ disuntikkan" : "—") },
  ];

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h1 className="text-xl font-semibold text-text-main">Percakapan</h1>
        <p className="text-sm text-text-muted">
          Log percakapan gateway — tiap permintaan chat tercatat sebagai satu giliran. Klik baris untuk melihat isi percakapan.
        </p>
      </div>

      {error && <Alert type="error" message={error} showIcon />}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          placeholder="Provider (mis. kimi)"
          style={{ width: 180 }}
        />
        <Input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="Model (mis. kimi-k3)"
          style={{ width: 180 }}
        />
        <Select
          value={status}
          onChange={setStatus}
          style={{ width: 160 }}
          options={[
            { value: "", label: "Semua status" },
            { value: "success", label: "Sukses" },
            { value: "error", label: "Error" },
          ]}
        />
        <Button type="primary" onClick={() => load(1)}>
          Cari
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-text-muted">Memuat…</p>
      ) : rows.length === 0 && !observabilityEnabled ? (
        <Alert
          type="warning"
          showIcon
          message="Pencatatan percakapan sedang mati."
          description={
            <span>
              Observability belum diaktifkan, jadi tidak ada percakapan yang tersimpan. Aktifkan di
              Pengaturan → Observability (atau set environment <code>ENABLE_REQUEST_LOGS=true</code>)
              lalu restart — percakapan baru akan muncul di sini.
            </span>
          }
        />
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-muted">Belum ada percakapan tercatat untuk filter ini.</p>
      ) : (
        <Card styles={{ body: { padding: 0 } }}>
          <Table
            columns={columns}
            dataSource={rows}
            rowKey="id"
            loading={loading}
            pagination={false}
            scroll={{ x: 800 }}
            onRow={(d) => ({
              onClick: () => openDetail(d.id),
              style: { cursor: "pointer", background: selectedId === d.id ? "var(--ant-color-fill-tertiary)" : undefined },
            })}
          />
        </Card>
      )}

      {pagination.totalPages > 1 && (
        <Pagination
          current={pagination.page}
          total={pagination.totalItems}
          pageSize={pagination.pageSize}
          onChange={(page) => load(page)}
          showTotal={(total) => `${total} percakapan`}
        />
      )}

      {selectedId && (
        <Card
          title="Detail percakapan"
          extra={<Button type="text" size="small" onClick={() => { setSelectedId(null); setDetail(null); }}>Tutup ✕</Button>}
          loading={detailLoading}
        >
          {detail?.error ? (
            <Typography.Text type="danger">{detail.error}</Typography.Text>
          ) : detail ? (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-text-muted">
                {detail.detail.model} · {detail.detail.provider} · {fmtTime(detail.detail.timestamp)} ·{" "}
                {detail.detail.status} · {(detail.detail.tokens?.prompt_tokens || 0) + (detail.detail.tokens?.completion_tokens || 0)} token
                {detail.detail.liveInjected ? " · ⭐ live prompt disuntikkan (isinya disembunyikan)" : ""}
              </p>
              {(detail.turns || []).length === 0 ? (
                <p className="text-sm text-text-muted">Isi percakapan tidak tersimpan untuk permintaan ini (mis. respons streaming yang tidak selesai).</p>
              ) : (
                (detail.turns || []).map((t, i) => (
                  <div key={i} className="rounded-lg border border-border-subtle bg-bg-subtle px-3 py-2">
                    <div className="mb-1 flex items-center gap-2">
                      <Tag color={ROLE_TAG_COLOR[t.kind] || "default"}>{t.role}{t.truncated ? " · dipotong" : ""}</Tag>
                    </div>
                    <pre className="whitespace-pre-wrap break-words font-sans text-sm text-text-main">{t.content}</pre>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </Card>
      )}
    </div>
  );
}
