"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, List, Segmented, Statistic, Table, Tag, Typography } from "antd";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

// Member dashboard (v1, read-only): own usage + own API keys.
// Usage auto-refreshes by polling the scoped /api/usage/history every 5s
// (no SSE in v1). The raw API key is never stored in the browser — it is
// only shown masked, with a copy button that copies the full value once.
const PERIODS = [
  { value: "today", label: "Hari ini" },
  { value: "24h", label: "24 jam" },
  { value: "7d", label: "7 hari" },
  { value: "30d", label: "30 hari" },
  { value: "all", label: "Semua" },
];

const POLL_MS = 5000;

function maskKey(key) {
  if (!key || typeof key !== "string") return "-";
  const t = key.trim();
  if (t.length <= 12) return `${t.charAt(0)}***`;
  return `${t.slice(0, 8)}***${t.slice(-4)}`;
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString("en-US");
}

function fmtCost(n) {
  return `$${Number(n || 0).toFixed(4)}`;
}

function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleString("id-ID", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch {
    return ts || "-";
  }
}

const byModelColumns = [
  { title: "Model", dataIndex: "model", key: "model" },
  { title: "Requests", dataIndex: "requests", key: "requests", render: (v) => fmtNum(v) },
  { title: "Prompt", dataIndex: "promptTokens", key: "promptTokens", render: (v) => fmtNum(v) },
  { title: "Completion", dataIndex: "completionTokens", key: "completionTokens", render: (v) => fmtNum(v) },
  { title: "Biaya", dataIndex: "cost", key: "cost", render: (v) => fmtCost(v) },
];

const recentColumns = [
  { title: "Waktu", dataIndex: "timestamp", key: "timestamp", render: (v) => fmtTime(v) },
  { title: "Model", dataIndex: "model", key: "model", render: (v) => v || "-" },
  { title: "Provider", dataIndex: "provider", key: "provider", render: (v) => v || "-" },
  {
    title: "Tokens",
    dataIndex: "tokens",
    key: "tokens",
    render: (v) => fmtNum(v),
  },
  {
    title: "Status",
    dataIndex: "status",
    key: "status",
    render: (v) => (
      <Tag color={v === "ok" ? "success" : "error"}>{v === "ok" ? "OK" : v || "-"}</Tag>
    ),
  },
];

export default function MemberDashboardPage() {
  const router = useRouter();
  const [memberName, setMemberName] = useState("");
  const [keys, setKeys] = useState([]);
  const [keysError, setKeysError] = useState("");
  const [period, setPeriod] = useState("today");
  const [stats, setStats] = useState(null);
  const [statsError, setStatsError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [loading, setLoading] = useState(true);
  const { copied, copy } = useCopyToClipboard(2000);

  // Telegram linking (one-time code, 10 min). The code is shown once;
  // the member sends /start <code> to the bot to link their chat.
  const [linkCode, setLinkCode] = useState(null);
  const [linkBotUsername, setLinkBotUsername] = useState("");
  const [linkExpiresInSec, setLinkExpiresInSec] = useState(0);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState("");

  // Compensation history (§0d, read-only): time extensions granted by the
  // admin for gateway outages. Fetched once on mount (rarely changes).
  const [compensations, setCompensations] = useState([]);
  const [compensationsError, setCompensationsError] = useState("");

  const fetchCompensations = useCallback(async () => {
    try {
      const res = await fetch("/api/compensations");
      const data = await res.json();
      if (Array.isArray(data?.compensations)) setCompensations(data.compensations);
      else setCompensationsError(data?.error || "Gagal memuat riwayat kompensasi");
    } catch {
      setCompensationsError("Gagal memuat riwayat kompensasi");
    }
  }, []);

  useEffect(() => {
    fetchCompensations();
  }, [fetchCompensations]);

  const requestLinkCode = async () => {
    setLinkLoading(true);
    setLinkError("");
    try {
      const res = await fetch("/api/auth/telegram-link", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Gagal membuat kode");
      setLinkCode(data.code);
      setLinkBotUsername(data.botUsername || "");
      setLinkExpiresInSec(data.expiresInSec || 600);
    } catch (e) {
      setLinkError(e?.message || "Gagal membuat kode");
    } finally {
      setLinkLoading(false);
    }
  };

  useEffect(() => {
    fetch("/api/auth/status")
      .then((r) => r.json())
      .then((d) => {
        if (d?.role === "member") setMemberName(d.memberName || "");
        else if (d?.authenticated) router.replace("/dashboard");
        else router.replace("/login");
      })
      .catch(() => {});
  }, [router]);

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetch("/api/keys");
      const data = await res.json();
      if (Array.isArray(data?.keys)) setKeys(data.keys);
      else setKeysError(data?.error || "Gagal memuat kunci API");
    } catch {
      setKeysError("Gagal memuat kunci API");
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/usage/history?period=${period}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Gagal memuat usage");
      setStats(data);
      setStatsError("");
      setLastUpdated(new Date());
    } catch (e) {
      setStatsError(e?.message || "Gagal memuat usage");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    setLoading(true);
    fetchStats();
    fetchKeys();
    const timer = setInterval(() => {
      if (document.hidden) return;
      fetchStats();
      fetchKeys();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [fetchStats, fetchKeys]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
  };

  const byModel = stats?.byModel
    ? Object.entries(stats.byModel)
        .sort((a, b) => b[1].requests - a[1].requests)
        .map(([key, v]) => ({
          key,
          model: v.rawModel || key,
          requests: v.requests,
          promptTokens: v.promptTokens,
          completionTokens: v.completionTokens,
          cost: v.cost,
        }))
    : [];
  const recent = Array.isArray(stats?.recentRequests)
    ? stats.recentRequests.map((r, i) => ({
        key: `${r.timestamp}-${i}`,
        timestamp: r.timestamp,
        model: r.model,
        provider: r.provider,
        tokens: (r.promptTokens || 0) + (r.completionTokens || 0),
        status: r.status,
      }))
    : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Typography.Title level={2} style={{ margin: 0 }}>
            Dashboard Member
          </Typography.Title>
          <Typography.Text type="secondary">
            {memberName ? `Halo, ${memberName} — ` : ""}penggunaan &amp; kunci API kamu (read-only).
          </Typography.Text>
        </div>
        <div className="flex items-center gap-2">
          <Tag color="success">
            Live · diperbarui {lastUpdated ? fmtTime(lastUpdated) : "…"} (5 dtk)
          </Tag>
          <Button onClick={handleLogout}>Keluar</Button>
        </div>
      </div>

      {/* Period selector */}
      <Segmented
        options={PERIODS.map((p) => ({ label: p.label, value: p.value }))}
        value={period}
        onChange={(v) => setPeriod(v)}
      />

      {statsError && (
        <Alert
          type="warning"
          message={`${statsError} — data terakhir tetap ditampilkan.`}
          showIcon
        />
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <Statistic title="Requests" value={loading ? "…" : fmtNum(stats?.totalRequests)} />
        </Card>
        <Card>
          <Statistic title="Prompt tokens" value={loading ? "…" : fmtNum(stats?.totalPromptTokens)} />
        </Card>
        <Card>
          <Statistic title="Completion tokens" value={loading ? "…" : fmtNum(stats?.totalCompletionTokens)} />
        </Card>
        <Card>
          <Statistic title="Biaya" value={loading ? "…" : fmtCost(stats?.totalCost)} />
        </Card>
      </div>

      {/* Per-model breakdown */}
      <Card title="Penggunaan per model">
        <Table
          columns={byModelColumns}
          dataSource={byModel}
          pagination={false}
          scroll={{ x: 600 }}
          locale={{ emptyText: "Belum ada request pada periode ini." }}
        />
      </Card>

      {/* Recent requests */}
      <Card title="Request terbaru">
        <Table
          columns={recentColumns}
          dataSource={recent}
          pagination={false}
          scroll={{ x: 600 }}
          locale={{ emptyText: "Belum ada request pada periode ini." }}
        />
      </Card>

      {/* Own API keys (read-only) */}
      <Card title="Kunci API saya">
        {keysError && <Alert type="error" message={keysError} showIcon className="mb-3" />}
        {keys.length === 0 && !keysError ? (
          <Typography.Text type="secondary">
            Belum ada kunci API yang ditetapkan ke akunmu. Minta admin untuk menetapkan kunci.
          </Typography.Text>
        ) : (
          <List
            dataSource={keys}
            renderItem={(k) => (
              <List.Item
                actions={[
                  <Button key="copy" onClick={() => copy(k.key)}>
                    {copied ? "Disalin!" : "Salin kunci"}
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={k.name || "Unnamed key"}
                  description={
                    <div className="flex flex-col gap-0.5">
                      <span className="font-mono text-xs">{maskKey(k.key)}</span>
                      <span>
                        Dibuat {k.createdAt ? fmtTime(k.createdAt) : "-"} ·{" "}
                        <Tag color={k.isActive ? "success" : "error"}>
                          {k.isActive ? "Aktif" : "Nonaktif"}
                        </Tag>
                      </span>
                      <span>
                        RPM: {k.rate ? `${k.rate.used}/${k.rate.limit} per menit` : "…"}
                        {k.rate?.source ? ` · batas ${k.rate.source === "key" ? "per kunci" : k.rate.source === "package" ? `paket${k.rate.packageName ? ` (${k.rate.packageName})` : ""}` : k.rate.source === "trial-default" ? "default trial" : "global"}` : ""}
                      </span>
                      <span>
                        IP aktif: {k.ip ? `${k.ip.activeCount}/${k.ip.cap} dalam 10 mnt` : "…"}
                        {k.ip?.source === "key" ? " · batas per kunci" : " · default 3"}
                      </span>
                    </div>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Card>

      {/* Riwayat Kompensasi (§0d, read-only) */}
      <Card title="Riwayat Kompensasi">
        {compensationsError && (
          <Alert type="error" message={compensationsError} showIcon className="mb-3" />
        )}
        {compensations.length === 0 && !compensationsError ? (
          <Typography.Text type="secondary">
            Belum ada kompensasi. Kalau gateway pernah gangguan, admin memberi perpanjangan masa aktif kunci — riwayatnya tampil di sini.
          </Typography.Text>
        ) : (
          <List
            dataSource={compensations}
            renderItem={(c) => (
              <List.Item key={c.id}>
                <List.Item.Meta
                  title={`+${c.amount} jam — gangguan ${c.incidentStartedAt ? fmtTime(c.incidentStartedAt) : c.incidentId.slice(0, 8)}${c.incidentDurationMinutes != null ? ` (${c.incidentDurationMinutes} menit)` : ""}`}
                  description={`Diberikan ${c.grantedAt ? fmtTime(c.grantedAt) : "-"}${c.newExpiresAt ? ` · masa berlaku baru ${fmtTime(c.newExpiresAt)}` : ""}`}
                />
              </List.Item>
            )}
          />
        )}
      </Card>

      {/* Hubungkan Telegram */}
      <Card title="Hubungkan Telegram">
        <Typography.Paragraph type="secondary">
          Hubungkan akun Telegram kamu untuk cek penggunaan, kunci, beli paket, dan klaim trial langsung dari bot.
        </Typography.Paragraph>
        {linkError && <Alert type="error" message={linkError} showIcon className="mb-3" />}
        {linkCode ? (
          <div className="flex flex-col gap-2">
            <div>
              Kode kamu:{" "}
              <Typography.Text strong copyable={false} className="font-mono text-lg tracking-widest">
                {linkCode}
              </Typography.Text>{" "}
              <Typography.Text type="secondary">
                (berlaku {Math.floor(linkExpiresInSec / 60)} menit, sekali pakai)
              </Typography.Text>
            </div>
            {linkBotUsername ? (
              <Typography.Text type="secondary">
                Kirim ke bot:{" "}
                <Typography.Link
                  href={`https://t.me/${linkBotUsername}?start=${linkCode}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono"
                >
                  t.me/{linkBotUsername}?start={linkCode}
                </Typography.Link>
              </Typography.Text>
            ) : (
              <Typography.Text type="secondary">
                Kirim <Typography.Text code>/start {linkCode}</Typography.Text> ke bot Telegram H-router.
              </Typography.Text>
            )}
            <div className="flex gap-2">
              <Button onClick={() => copy(linkCode)}>{copied ? "Disalin!" : "Salin kode"}</Button>
              <Button onClick={requestLinkCode}>Buat kode baru</Button>
            </div>
          </div>
        ) : (
          <Button type="primary" onClick={requestLinkCode} loading={linkLoading}>
            {linkLoading ? "Membuat kode…" : "Buat kode hubung"}
          </Button>
        )}
      </Card>
    </div>
  );
}
