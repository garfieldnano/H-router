"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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

  const byModel = stats?.byModel ? Object.entries(stats.byModel).sort((a, b) => b[1].requests - a[1].requests) : [];
  const recent = Array.isArray(stats?.recentRequests) ? stats.recentRequests : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-main">Dashboard Member</h1>
          <p className="text-sm text-text-muted">
            {memberName ? `Halo, ${memberName} — ` : ""}penggunaan &amp; kunci API kamu (read-only).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface-2 px-3 py-1 text-xs text-text-muted">
            <span className="block h-2 w-2 rounded-full bg-success animate-pulse" />
            Live · diperbarui {lastUpdated ? fmtTime(lastUpdated) : "…"} (5 dtk)
          </span>
          <button
            onClick={handleLogout}
            className="rounded-lg border border-border-subtle bg-surface-2 px-3 py-1.5 text-sm text-text-main hover:bg-bg-hover"
          >
            Keluar
          </button>
        </div>
      </div>

      {/* Period selector */}
      <div className="flex items-center gap-1 rounded-lg border border-border bg-bg-subtle p-1 w-fit">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            onClick={() => setPeriod(p.value)}
            className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
              period === p.value ? "bg-primary text-white shadow-sm" : "text-text-muted hover:bg-bg-hover hover:text-text"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {statsError && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 dark:bg-yellow-900/20 dark:border-yellow-800 p-3 text-sm text-text-main">
          {statsError} — data terakhir tetap ditampilkan.
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "Requests", value: fmtNum(stats?.totalRequests) },
          { label: "Prompt tokens", value: fmtNum(stats?.totalPromptTokens) },
          { label: "Completion tokens", value: fmtNum(stats?.totalCompletionTokens) },
          { label: "Biaya", value: fmtCost(stats?.totalCost) },
        ].map((c) => (
          <div key={c.label} className="bg-surface-2 border border-border-subtle rounded-lg p-4">
            <div className="text-xs text-text-muted">{c.label}</div>
            <div className="mt-1 text-2xl font-bold text-text-main">{loading ? "…" : c.value}</div>
          </div>
        ))}
      </div>

      {/* Per-model breakdown */}
      <div className="bg-surface-2 border border-border-subtle rounded-lg p-4">
        <h2 className="mb-3 text-lg font-semibold text-text-main">Penggunaan per model</h2>
        {byModel.length === 0 ? (
          <p className="text-sm text-text-muted">Belum ada request pada periode ini.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-muted">
                  <th className="py-2 pr-3 font-medium">Model</th>
                  <th className="py-2 pr-3 font-medium">Requests</th>
                  <th className="py-2 pr-3 font-medium">Prompt</th>
                  <th className="py-2 pr-3 font-medium">Completion</th>
                  <th className="py-2 font-medium">Biaya</th>
                </tr>
              </thead>
              <tbody>
                {byModel.map(([key, v]) => (
                  <tr key={key} className="border-t border-border-subtle hover:bg-bg-subtle">
                    <td className="py-2 pr-3 text-text-main">{v.rawModel || key}</td>
                    <td className="py-2 pr-3">{fmtNum(v.requests)}</td>
                    <td className="py-2 pr-3">{fmtNum(v.promptTokens)}</td>
                    <td className="py-2 pr-3">{fmtNum(v.completionTokens)}</td>
                    <td className="py-2">{fmtCost(v.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent requests */}
      <div className="bg-surface-2 border border-border-subtle rounded-lg p-4">
        <h2 className="mb-3 text-lg font-semibold text-text-main">Request terbaru</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-text-muted">Belum ada request pada periode ini.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-muted">
                  <th className="py-2 pr-3 font-medium">Waktu</th>
                  <th className="py-2 pr-3 font-medium">Model</th>
                  <th className="py-2 pr-3 font-medium">Provider</th>
                  <th className="py-2 pr-3 font-medium">Tokens</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r, i) => (
                  <tr key={`${r.timestamp}-${i}`} className="border-t border-border-subtle hover:bg-bg-subtle">
                    <td className="py-2 pr-3 whitespace-nowrap text-text-main">{fmtTime(r.timestamp)}</td>
                    <td className="py-2 pr-3 text-text-main">{r.model || "-"}</td>
                    <td className="py-2 pr-3">{r.provider || "-"}</td>
                    <td className="py-2 pr-3">{fmtNum((r.promptTokens || 0) + (r.completionTokens || 0))}</td>
                    <td className="py-2">
                      <span className={`inline-block h-2 w-2 rounded-full ${r.status === "ok" ? "bg-success" : "bg-error"}`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Own API keys (read-only) */}
      <div className="bg-surface-2 border border-border-subtle rounded-lg p-4">
        <h2 className="mb-3 text-lg font-semibold text-text-main">Kunci API saya</h2>
        {keysError && <p className="text-sm text-error">{keysError}</p>}
        {keys.length === 0 && !keysError ? (
          <p className="text-sm text-text-muted">
            Belum ada kunci API yang ditetapkan ke akunmu. Minta admin untuk menetapkan kunci.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {keys.map((k) => (
              <div key={k.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-subtle bg-bg-subtle p-3">
                <div>
                  <div className="font-medium text-text-main">{k.name || "Unnamed key"}</div>
                  <div className="font-mono text-xs text-text-muted">{maskKey(k.key)}</div>
                  <div className="text-xs text-text-muted">
                    Dibuat {k.createdAt ? fmtTime(k.createdAt) : "-"} ·{" "}
                    <span className={k.isActive ? "text-success" : "text-error"}>
                      {k.isActive ? "Aktif" : "Nonaktif"}
                    </span>
                  </div>
                  <div className="text-xs text-text-muted">
                    RPM: {k.rate ? `${k.rate.used}/${k.rate.limit} per menit` : "…"}
                    {k.rate?.source ? ` · batas ${k.rate.source === "key" ? "per kunci" : k.rate.source === "package" ? `paket${k.rate.packageName ? ` (${k.rate.packageName})` : ""}` : k.rate.source === "trial-default" ? "default trial" : "global"}` : ""}
                  </div>
                  <div className="text-xs text-text-muted">
                    IP aktif: {k.ip ? `${k.ip.activeCount}/${k.ip.cap} dalam 10 mnt` : "…"}
                    {k.ip?.source === "key" ? " · batas per kunci" : " · default 3"}
                  </div>
                </div>
                <button
                  onClick={() => copy(k.key)}
                  className="rounded-lg border border-border-subtle bg-surface px-3 py-1.5 text-sm text-text-main hover:bg-bg-hover"
                >
                  {copied ? "Disalin!" : "Salin kunci"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* Riwayat Kompensasi (§0d, read-only) */}
      <div className="bg-surface-2 border border-border-subtle rounded-lg p-4">
        <h2 className="mb-3 text-lg font-semibold text-text-main">Riwayat Kompensasi</h2>
        {compensationsError && <p className="text-sm text-error">{compensationsError}</p>}
        {compensations.length === 0 && !compensationsError ? (
          <p className="text-sm text-text-muted">
            Belum ada kompensasi. Kalau gateway pernah gangguan, admin memberi perpanjangan masa aktif kunci — riwayatnya tampil di sini.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {compensations.map((c) => (
              <div key={c.id} className="rounded-lg border border-border-subtle bg-bg-subtle p-3 text-sm">
                <div className="font-medium text-text-main">
                  +{c.amount} jam — gangguan {c.incidentStartedAt ? fmtTime(c.incidentStartedAt) : c.incidentId.slice(0, 8)}
                  {c.incidentDurationMinutes != null ? ` (${c.incidentDurationMinutes} menit)` : ""}
                </div>
                <div className="text-xs text-text-muted">
                  Diberikan {c.grantedAt ? fmtTime(c.grantedAt) : "-"}
                  {c.newExpiresAt ? ` · masa berlaku baru ${fmtTime(c.newExpiresAt)}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Hubungkan Telegram */}
      <div className="bg-surface-2 border border-border-subtle rounded-lg p-4">
        <h2 className="mb-3 text-lg font-semibold text-text-main">Hubungkan Telegram</h2>
        <p className="mb-3 text-sm text-text-muted">
          Hubungkan akun Telegram kamu untuk cek penggunaan, kunci, beli paket, dan klaim trial langsung dari bot.
        </p>
        {linkError && <p className="mb-2 text-sm text-error">{linkError}</p>}
        {linkCode ? (
          <div className="flex flex-col gap-2">
            <div className="text-sm text-text-main">
              Kode kamu: <span className="font-mono text-lg font-bold tracking-widest">{linkCode}</span>
              <span className="ml-2 text-xs text-text-muted">(berlaku {Math.floor(linkExpiresInSec / 60)} menit, sekali pakai)</span>
            </div>
            {linkBotUsername ? (
              <div className="text-sm text-text-muted">
                Kirim ke bot:{" "}
                <a
                  className="font-mono text-primary underline"
                  href={`https://t.me/${linkBotUsername}?start=${linkCode}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  t.me/{linkBotUsername}?start={linkCode}
                </a>
              </div>
            ) : (
              <p className="text-sm text-text-muted">
                Kirim <span className="font-mono">/start {linkCode}</span> ke bot Telegram h-router.
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => copy(linkCode)}
                className="rounded-lg border border-border-subtle bg-surface px-3 py-1.5 text-sm text-text-main hover:bg-bg-hover"
              >
                {copied ? "Disalin!" : "Salin kode"}
              </button>
              <button
                onClick={requestLinkCode}
                className="rounded-lg border border-border-subtle bg-surface px-3 py-1.5 text-sm text-text-main hover:bg-bg-hover"
              >
                Buat kode baru
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={requestLinkCode}
            disabled={linkLoading}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {linkLoading ? "Membuat kode…" : "Buat kode hubung"}
          </button>
        )}
      </div>
    </div>
  );
}
