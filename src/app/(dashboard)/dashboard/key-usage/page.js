"use client";

import { Fragment, useCallback, useEffect, useState } from "react";

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
  const [totals, setTotals] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/usage/by-key?period=${period}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Gagal memuat pemakaian kunci (${res.status})`);
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setTotals(data.totals || null);
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

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-main">Pemakaian Kunci</h1>
          <p className="text-sm text-text-muted">
            Request, token, dan biaya per API key — klik baris untuk rincian per model.
          </p>
        </div>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-text-main"
        >
          {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </div>

      {error && <div className="rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">{error}</div>}

      {totals && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ["Total request", totals.requests.toLocaleString("id-ID")],
            ["Token input", totals.promptTokens.toLocaleString("id-ID")],
            ["Token output", totals.completionTokens.toLocaleString("id-ID")],
            ["Total biaya", `$${(totals.cost || 0).toFixed(4)}`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border-subtle bg-surface p-3">
              <div className="text-2xl font-semibold text-text-main">{value}</div>
              <div className="text-xs text-text-muted">{label}</div>
            </div>
          ))}
        </div>
      )}

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Cari kunci / member…"
        className="w-full max-w-sm rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-text-main"
      />

      {loading ? (
        <p className="text-sm text-text-muted">Memuat…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-text-muted">Tidak ada kunci untuk filter ini.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border-subtle">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-bg-subtle text-left text-text-muted">
                <th className="px-3 py-2">Kunci</th>
                <th className="px-3 py-2">Member</th>
                <th className="px-3 py-2 text-right">Request</th>
                <th className="px-3 py-2 text-right">Token In</th>
                <th className="px-3 py-2 text-right">Token Out</th>
                <th className="px-3 py-2 text-right">Biaya</th>
                <th className="px-3 py-2">Terakhir dipakai</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <Fragment key={r.keyId || r.maskedKey || "local"}>
                  <tr
                    onClick={() => setExpanded(expanded === (r.keyId || r.maskedKey) ? null : (r.keyId || r.maskedKey))}
                    className="cursor-pointer border-b border-border-subtle hover:bg-bg-subtle"
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium text-text-main">{r.keyName}</div>
                      <div className="font-mono text-xs text-text-muted">{r.maskedKey || "—"}</div>
                      {r.isActive === false && <span className="text-xs text-error">nonaktif</span>}
                    </td>
                    <td className="px-3 py-2 text-text-muted">{r.memberName || "—"}</td>
                    <td className="px-3 py-2 text-right text-text-main">{r.requests.toLocaleString("id-ID")}</td>
                    <td className="px-3 py-2 text-right text-text-main">{r.promptTokens.toLocaleString("id-ID")}</td>
                    <td className="px-3 py-2 text-right text-text-main">{r.completionTokens.toLocaleString("id-ID")}</td>
                    <td className="px-3 py-2 text-right text-text-main">${(r.cost || 0).toFixed(4)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-text-muted">{fmtTime(r.lastUsed)}</td>
                  </tr>
                  {expanded === (r.keyId || r.maskedKey) && (
                    <tr className="border-b border-border-subtle bg-bg-subtle">
                      <td colSpan={7} className="px-3 py-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-text-muted">Per model</div>
                        {r.models.length === 0 ? (
                          <p className="text-sm text-text-muted">Tidak ada pemakaian pada periode ini.</p>
                        ) : (
                          <ul className="mt-1 flex flex-col gap-1 text-sm">
                            {r.models.map((m) => (
                              <li key={`${m.model}-${m.provider}`} className="flex justify-between gap-2">
                                <span className="text-text-main">{m.model} <span className="text-text-muted">({m.provider})</span></span>
                                <span className="text-text-muted">{m.requests.toLocaleString("id-ID")} request</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        <p className="mt-2 text-xs text-text-muted">
                          RPM: {r.rpmLimit ?? "default"} · Batas IP: {r.maxIps ?? "default (3)"}
                        </p>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
