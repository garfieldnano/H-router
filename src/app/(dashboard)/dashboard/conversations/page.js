"use client";

import { useCallback, useEffect, useState } from "react";

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

const ROLE_CLASS = {
  system: "border-warning/40 bg-warning/10",
  user: "border-border-subtle bg-bg-subtle",
  assistant: "border-success/40 bg-success/10",
  tool: "border-border-subtle bg-surface text-text-muted",
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

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h1 className="text-xl font-semibold text-text-main">Percakapan</h1>
        <p className="text-sm text-text-muted">
          Log percakapan gateway — tiap permintaan chat tercatat sebagai satu giliran. Klik baris untuk melihat isi percakapan.
        </p>
      </div>

      {error && <div className="rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">{error}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          placeholder="Provider (mis. kimi)"
          className="rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-text-main"
        />
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="Model (mis. kimi-k3)"
          className="rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-text-main"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-text-main"
        >
          <option value="">Semua status</option>
          <option value="success">Sukses</option>
          <option value="error">Error</option>
        </select>
        <button
          onClick={() => load(1)}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white"
        >
          Cari
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-text-muted">Memuat…</p>
      ) : rows.length === 0 && !observabilityEnabled ? (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          <p className="font-medium">Pencatatan percakapan sedang mati.</p>
          <p>
            Observability belum diaktifkan, jadi tidak ada percakapan yang tersimpan. Aktifkan di
            Pengaturan → Observability (atau set environment <code>ENABLE_REQUEST_LOGS=true</code>)
            lalu restart — percakapan baru akan muncul di sini.
          </p>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-muted">Belum ada percakapan tercatat untuk filter ini.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border-subtle">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-bg-subtle text-left text-text-muted">
                <th className="px-3 py-2">Waktu</th>
                <th className="px-3 py-2">Model</th>
                <th className="px-3 py-2">Provider</th>
                <th className="px-3 py-2 text-right">Token</th>
                <th className="px-3 py-2 text-right">Latensi</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Live prompt</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr
                  key={d.id}
                  onClick={() => openDetail(d.id)}
                  className={`cursor-pointer border-b border-border-subtle last:border-0 hover:bg-bg-subtle ${selectedId === d.id ? "bg-bg-subtle" : ""}`}
                >
                  <td className="whitespace-nowrap px-3 py-2 text-text-muted">{fmtTime(d.timestamp)}</td>
                  <td className="px-3 py-2 text-text-main">{d.model || "—"}</td>
                  <td className="px-3 py-2 text-text-muted">{d.provider || "—"}</td>
                  <td className="px-3 py-2 text-right text-text-main">
                    {((d.tokens?.prompt_tokens || 0) + (d.tokens?.completion_tokens || 0)).toLocaleString("id-ID")}
                  </td>
                  <td className="px-3 py-2 text-right text-text-muted">{d.latency?.total ? `${d.latency.total} ms` : "—"}</td>
                  <td className={d.status === "success" ? "px-3 py-2 text-success" : "px-3 py-2 text-error"}>{d.status || "—"}</td>
                  <td className="px-3 py-2 text-text-muted">{d.live_injected ? "⭐ disuntikkan" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination.totalPages > 1 && (
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <button
            onClick={() => load(pagination.page - 1)}
            disabled={pagination.page <= 1}
            className="rounded-lg border border-border-subtle px-3 py-1 disabled:opacity-50"
          >
            ← Sebelumnya
          </button>
          <span>Halaman {pagination.page} dari {pagination.totalPages} ({pagination.totalItems} percakapan)</span>
          <button
            onClick={() => load(pagination.page + 1)}
            disabled={pagination.page >= pagination.totalPages}
            className="rounded-lg border border-border-subtle px-3 py-1 disabled:opacity-50"
          >
            Berikutnya →
          </button>
        </div>
      )}

      {selectedId && (
        <div className="rounded-lg border border-border-subtle bg-surface p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-text-main">Detail percakapan</h2>
            <button onClick={() => { setSelectedId(null); setDetail(null); }} className="text-sm text-text-muted hover:text-text-main">Tutup ✕</button>
          </div>
          {detailLoading ? (
            <p className="text-sm text-text-muted">Memuat detail…</p>
          ) : detail?.error ? (
            <p className="text-sm text-error">{detail.error}</p>
          ) : detail ? (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-text-muted">
                {detail.detail.model} · {detail.detail.provider} · {fmtTime(detail.detail.timestamp)} ·{" "}
                {detail.detail.status} · {(detail.detail.tokens?.prompt_tokens || 0) + (detail.detail.tokens?.completion_tokens || 0)} token
                {detail.detail.liveInjected ? " · ⭐ live prompt disuntikkan (isinya disembunyikan)" : ""}
              </p>
              {detail.turns.length === 0 ? (
                <p className="text-sm text-text-muted">Isi percakapan tidak tersimpan untuk permintaan ini (mis. respons streaming yang tidak selesai).</p>
              ) : (
                detail.turns.map((t, i) => (
                  <div key={i} className={`rounded-lg border px-3 py-2 ${ROLE_CLASS[t.kind] || ROLE_CLASS.user}`}>
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">{t.role}{t.truncated ? " · dipotong" : ""}</div>
                    <pre className="whitespace-pre-wrap break-words font-sans text-sm text-text-main">{t.content}</pre>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
