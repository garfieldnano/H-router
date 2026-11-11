"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Admin-only health scanner (plan #5): scans every active provider
// connection with the existing per-connection probe (testSingleConnection)
// and classifies it healthy / limit / dead / unknown. Only "dead"
// connections may be bulk-deleted — the server re-checks the stored
// status, and the UI asks for confirmation first.
function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleString("id-ID", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return ts || "-";
  }
}

const STATUS_LABEL = {
  healthy: "Sehat",
  limit: "Limit",
  dead: "Mati",
  unknown: "Tidak diketahui",
};

const STATUS_CLASS = {
  healthy: "text-success",
  limit: "text-warning",
  dead: "text-error",
  unknown: "text-text-muted",
};

export default function ScannerPage() {
  const [scan, setScan] = useState(null);
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("all");
  const [starting, setStarting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/keys/scan");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Gagal memuat status scan (${res.status})`);
        return;
      }
      setScan(data.scan || null);
      setConnections(Array.isArray(data.connections) ? data.connections : []);
      setError("");
    } catch (e) {
      setError(e?.message || "Gagal memuat status scan");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Poll while a scan is running; stop when it finishes.
  useEffect(() => {
    if (scan?.running) {
      pollRef.current = setInterval(load, 2000);
      return () => clearInterval(pollRef.current);
    }
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return undefined;
  }, [scan?.running, load]);

  const startScan = async () => {
    setStarting(true);
    setNotice("");
    try {
      const res = await fetch("/api/keys/scan", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setNotice("Scan sudah berjalan — menunggu hasil…");
      } else if (!res.ok) {
        setError(data.error || `Gagal memulai scan (${res.status})`);
      } else {
        setNotice("Scan dimulai — hasil muncul di bawah saat selesai.");
      }
      await load();
    } catch (e) {
      setError(e?.message || "Gagal memulai scan");
    } finally {
      setStarting(false);
    }
  };

  const deadIds = connections
    .filter((c) => c.healthStatus === "dead")
    .map((c) => c.id);

  const deleteDead = async () => {
    setDeleting(true);
    setNotice("");
    try {
      const res = await fetch("/api/keys/scan", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionIds: deadIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Gagal menghapus (${res.status})`);
      } else {
        setNotice(
          `Dihapus ${data.deletedCount ?? 0} koneksi mati` +
          (data.skipped?.length ? ` · ${data.skipped.length} dilewati (bukan mati lagi)` : "")
        );
      }
      setConfirmDelete(false);
      await load();
    } catch (e) {
      setError(e?.message || "Gagal menghapus");
    } finally {
      setDeleting(false);
    }
  };

  const counts = { healthy: 0, limit: 0, dead: 0, unknown: 0, unscanned: 0 };
  for (const c of connections) {
    if (!c.isActive) continue;
    if (!c.healthStatus) counts.unscanned++;
    else counts[c.healthStatus] = (counts[c.healthStatus] || 0) + 1;
  }
  const filtered = filter === "all"
    ? connections
    : connections.filter((c) => (c.healthStatus || "unscanned") === filter);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-main">Pemindai Kesehatan</h1>
          <p className="text-sm text-text-muted">
            Memeriksa semua akun provider aktif dengan probe yang sudah ada —
            Sehat / Limit / Mati / Tidak diketahui. Hanya koneksi Mati yang bisa dihapus massal.
          </p>
        </div>
        <button
          onClick={startScan}
          disabled={starting || scan?.running}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {scan?.running ? "Memindai…" : starting ? "Memulai…" : "Jalankan Scan"}
        </button>
      </div>

      {error && <div className="rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">{error}</div>}
      {notice && <div className="rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">{notice}</div>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ["Sehat", counts.healthy, "text-success"],
          ["Limit", counts.limit, "text-warning"],
          ["Mati", counts.dead, "text-error"],
          ["Tidak diketahui", counts.unknown, "text-text-muted"],
          ["Belum dipindai", counts.unscanned, "text-text-muted"],
        ].map(([label, n, cls]) => (
          <div key={label} className="rounded-lg border border-border-subtle bg-surface p-3">
            <div className={`text-2xl font-semibold ${cls}`}>{n}</div>
            <div className="text-xs text-text-muted">{label}</div>
          </div>
        ))}
      </div>

      {scan?.summary && (
        <p className="text-xs text-text-muted">
          Scan terakhir: {fmtTime(scan.summary.finishedAt)} · {scan.summary.total} koneksi ·{" "}
          {scan.summary.healthy} sehat · {scan.summary.limit} limit · {scan.summary.dead} mati ·{" "}
          {scan.summary.unknown} tidak diketahui · {(scan.summary.durationMs / 1000).toFixed(1)} dtk
        </p>
      )}
      {scan?.running && (
        <p className="text-xs text-text-muted">
          Memindai… {scan.done}/{scan.total} selesai
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-text-main"
        >
          <option value="all">Semua status</option>
          <option value="healthy">Sehat</option>
          <option value="limit">Limit</option>
          <option value="dead">Mati</option>
          <option value="unknown">Tidak diketahui</option>
          <option value="unscanned">Belum dipindai</option>
        </select>
        {deadIds.length > 0 && !confirmDelete && (
          <button
            onClick={() => setConfirmDelete(true)}
            className="rounded-lg border border-error/50 px-3 py-2 text-sm text-error hover:bg-error/10"
          >
            Hapus yang mati ({deadIds.length})
          </button>
        )}
        {confirmDelete && (
          <span className="inline-flex items-center gap-2 rounded-lg border border-error/50 bg-error/10 px-3 py-2 text-sm">
            <span className="text-error">Yakin hapus {deadIds.length} koneksi mati? Tindakan ini tidak bisa dibatalkan.</span>
            <button
              onClick={deleteDead}
              disabled={deleting}
              className="rounded bg-error px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              {deleting ? "Menghapus…" : "Ya, hapus"}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="rounded border border-border-subtle px-2 py-1 text-xs text-text-main"
            >
              Batal
            </button>
          </span>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-text-muted">Memuat…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-text-muted">Tidak ada koneksi untuk filter ini.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border-subtle">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-bg-subtle text-left text-text-muted">
                <th className="px-3 py-2">Koneksi</th>
                <th className="px-3 py-2">Provider</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Latensi</th>
                <th className="px-3 py-2">Terakhir dicek</th>
                <th className="px-3 py-2">Keterangan</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-b border-border-subtle last:border-0">
                  <td className="px-3 py-2 text-text-main">
                    {c.name}
                    {!c.isActive && <span className="ml-2 text-xs text-orange-500">Nonaktif</span>}
                  </td>
                  <td className="px-3 py-2 text-text-muted">{c.provider} · {c.authType}</td>
                  <td className={`px-3 py-2 font-medium ${c.healthStatus ? STATUS_CLASS[c.healthStatus] : "text-text-muted"}`}>
                    {c.healthStatus ? STATUS_LABEL[c.healthStatus] : "Belum dipindai"}
                  </td>
                  <td className="px-3 py-2 text-text-muted">{c.healthLatencyMs != null ? `${c.healthLatencyMs} ms` : "-"}</td>
                  <td className="px-3 py-2 text-text-muted">{c.healthCheckedAt ? fmtTime(c.healthCheckedAt) : "-"}</td>
                  <td className="max-w-xs truncate px-3 py-2 text-text-muted" title={c.healthError || ""}>
                    {c.healthError || "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
