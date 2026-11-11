"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Modal, Select, Statistic, Table, Tag } from "antd";

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

const STATUS_TAG_COLOR = {
  healthy: "success",
  limit: "warning",
  dead: "error",
  unknown: "default",
};

const FILTER_OPTIONS = [
  { value: "all", label: "Semua status" },
  { value: "healthy", label: "Sehat" },
  { value: "limit", label: "Limit" },
  { value: "dead", label: "Mati" },
  { value: "unknown", label: "Tidak diketahui" },
  { value: "unscanned", label: "Belum dipindai" },
];

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

  const columns = [
    {
      title: "Koneksi",
      dataIndex: "name",
      key: "name",
      render: (_v, c) => (
        <span>
          {c.name}
          {!c.isActive && <Tag color="orange" className="ml-2">Nonaktif</Tag>}
        </span>
      ),
    },
    {
      title: "Provider",
      key: "provider",
      render: (_v, c) => `${c.provider} · ${c.authType}`,
    },
    {
      title: "Status",
      dataIndex: "healthStatus",
      key: "status",
      render: (s) => s
        ? <Tag color={STATUS_TAG_COLOR[s]}>{STATUS_LABEL[s]}</Tag>
        : <span className="text-text-muted">Belum dipindai</span>,
    },
    {
      title: "Latensi",
      dataIndex: "healthLatencyMs",
      key: "latency",
      render: (ms) => (ms != null ? `${ms} ms` : "-"),
    },
    {
      title: "Terakhir dicek",
      dataIndex: "healthCheckedAt",
      key: "checkedAt",
      render: (ts) => (ts ? fmtTime(ts) : "-"),
    },
    {
      title: "Keterangan",
      dataIndex: "healthError",
      key: "error",
      ellipsis: true,
      render: (e) => e || "-",
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-main">Pemindai Kesehatan</h1>
          <p className="text-sm text-text-muted">
            Memeriksa semua akun provider aktif dengan probe yang sudah ada —
            Sehat / Limit / Mati / Tidak diketahui. Hanya koneksi Mati yang bisa dihapus massal.
          </p>
        </div>
        <Button
          type="primary"
          onClick={startScan}
          loading={starting || scan?.running}
          disabled={starting || scan?.running}
        >
          {scan?.running ? "Memindai…" : starting ? "Memulai…" : "Jalankan Scan"}
        </Button>
      </div>

      {error && <Alert type="error" message={error} showIcon />}
      {notice && <Alert type="success" message={notice} showIcon />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ["Sehat", counts.healthy],
          ["Limit", counts.limit],
          ["Mati", counts.dead],
          ["Tidak diketahui", counts.unknown],
          ["Belum dipindai", counts.unscanned],
        ].map(([label, n]) => (
          <Card key={label} styles={{ body: { padding: "12px 16px" } }}>
            <Statistic title={label} value={n} />
          </Card>
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
        <Select
          value={filter}
          onChange={setFilter}
          options={FILTER_OPTIONS}
          style={{ width: 180 }}
        />
        {deadIds.length > 0 && (
          <Button danger onClick={() => setConfirmDelete(true)}>
            Hapus yang mati ({deadIds.length})
          </Button>
        )}
      </div>

      <Card styles={{ body: { padding: 0 } }}>
        <Table
          columns={columns}
          dataSource={filtered}
          rowKey="id"
          loading={loading}
          pagination={false}
          scroll={{ x: 800 }}
          locale={{ emptyText: "Tidak ada koneksi untuk filter ini." }}
        />
      </Card>

      {/* antd Modal evaluates title/children on every render even while
          closed, so the body is guarded by confirmDelete (quota-crash
          lesson, wave 2). */}
      <Modal
        open={confirmDelete}
        onCancel={() => setConfirmDelete(false)}
        onOk={deleteDead}
        okText={deleting ? "Menghapus…" : "Ya, hapus"}
        okButtonProps={{ danger: true, loading: deleting }}
        title="Hapus koneksi mati?"
        destroyOnClose
      >
        {confirmDelete ? (
          <p>Yakin hapus {deadIds.length} koneksi mati? Tindakan ini tidak bisa dibatalkan.</p>
        ) : null}
      </Modal>
    </div>
  );
}
