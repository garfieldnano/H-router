"use client";

import { useEffect, useState } from "react";

// Member Quota Tracker (read-only): the member's OWN quota only — per-key
// RPM limit + current-minute usage and IP cap + active IPs, plus 30-day
// usage totals. Data comes from the already member-scoped /api/keys
// (rate/ip attached server-side) and /api/usage/stats. No admin controls,
// no other member's data, no provider-global quotas.
function maskKey(key) {
  if (!key || key.length <= 18) return key || "-";
  return `${key.slice(0, 14)}…${key.slice(-4)}`;
}

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

  if (error) return <p className="text-sm text-error">{error}</p>;
  if (keys === null) return <p className="text-sm text-text-muted">Memuat kuota…</p>;

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <div className="rounded-xl border border-border-subtle bg-surface p-4">
          <p className="text-xs text-text-muted">Request (30 hari)</p>
          <p className="mt-1 text-2xl font-semibold text-text-main">
            {(stats?.totalRequests ?? 0).toLocaleString("id-ID")}
          </p>
        </div>
        <div className="rounded-xl border border-border-subtle bg-surface p-4">
          <p className="text-xs text-text-muted">Biaya (30 hari)</p>
          <p className="mt-1 text-2xl font-semibold text-text-main">
            ${(stats?.totalCost ?? 0).toFixed(4)}
          </p>
        </div>
      </div>

      {keys.length === 0 ? (
        <p className="text-sm text-text-muted">Belum ada kunci API. Minta admin untuk menetapkan kunci ke akun Anda.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-xs text-text-muted">
                <th className="px-4 py-3 font-medium">Kunci</th>
                <th className="px-4 py-3 font-medium">Batas RPM</th>
                <th className="px-4 py-3 font-medium">Dipakai (menit ini)</th>
                <th className="px-4 py-3 font-medium">Sisa</th>
                <th className="px-4 py-3 font-medium">IP aktif / batas</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-b border-border-subtle last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium text-text-main">{k.name || "-"}</p>
                    <p className="font-mono text-xs text-text-muted">{maskKey(k.key)}</p>
                  </td>
                  <td className="px-4 py-3 text-text-main">
                    {k.rate?.limit ?? k.rpmLimit ?? "-"}
                    {k.rate?.packageName ? ` (${k.rate.packageName})` : ""}
                  </td>
                  <td className="px-4 py-3 text-text-main">{k.rate?.used ?? 0}</td>
                  <td className="px-4 py-3 text-text-main">{k.rate?.remaining ?? "-"}</td>
                  <td className="px-4 py-3 text-text-main">
                    {k.ip ? `${k.ip.activeCount} / ${k.ip.cap}` : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-text-muted">
        Kuota dihitung per kunci. Batas RPM dan IP diatur oleh admin — hubungi admin bila butuh penyesuaian.
      </p>
    </div>
  );
}
