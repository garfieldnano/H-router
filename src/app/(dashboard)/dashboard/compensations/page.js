"use client";

import { useCallback, useEffect, useState } from "react";

// Admin-only downtime compensation (§0d): incidents recorded by the
// gateway-uptime prober + manual time-extension grants. The system never
// grants automatically — the admin picks incident → member → key → tier
// and applies. Tier defaults to the one derived from the incident's
// duration (<1h +1h · 1–3h +3h · 3–5h +5h · >5h +8h); the admin may
// override it per grant. A key without expiresAt cannot be extended.
function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleString("id-ID", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return ts || "-";
  }
}

function fmtDate(ts) {
  try {
    return new Date(ts).toLocaleString("id-ID", { day: "2-digit", month: "short" });
  } catch {
    return ts || "-";
  }
}

const TIERS = [1, 3, 5, 8];

export default function CompensationsPage() {
  const [incidents, setIncidents] = useState([]);
  const [compensations, setCompensations] = useState([]);
  const [members, setMembers] = useState([]);
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [incidentId, setIncidentId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [keyId, setKeyId] = useState("");
  const [tierHours, setTierHours] = useState("");
  const [granting, setGranting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [iRes, cRes, mRes, kRes] = await Promise.all([
        fetch("/api/incidents"),
        fetch("/api/compensations"),
        fetch("/api/members"),
        fetch("/api/keys"),
      ]);
      const iData = await iRes.json();
      const cData = await cRes.json();
      const mData = await mRes.json();
      const kData = await kRes.json();
      if (!iRes.ok) throw new Error(iData?.error || "Gagal memuat insiden");
      if (!cRes.ok) throw new Error(cData?.error || "Gagal memuat kompensasi");
      setIncidents(iData.incidents || []);
      setCompensations(cData.compensations || []);
      setMembers(mData.members || mData || []);
      setKeys(kData.keys || []);
      setError("");
    } catch (e) {
      setError(e?.message || "Gagal memuat data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selectedIncident = incidents.find((i) => i.id === incidentId) || null;
  const memberKeys = keys.filter((k) => k.memberId === memberId);
  const selectedKey = keys.find((k) => k.id === keyId) || null;
  const derivedTier = selectedIncident?.derivedTierHours ?? null;
  const effectiveTier = tierHours === "" ? derivedTier : Number(tierHours);
  const keyEligible = selectedKey ? Boolean(selectedKey.isActive && selectedKey.expiresAt) : false;

  const grant = async (e) => {
    e.preventDefault();
    if (!incidentId || !keyId) return;
    setGranting(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/incidents/${incidentId}/grant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyId, tierHours: tierHours === "" ? null : Number(tierHours) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Gagal memberi kompensasi");
      setNotice(
        `Kompensasi +${data.compensation.amount} jam diberikan ke kunci ${data.key.name || data.key.id.slice(0, 8)} — masa berlaku baru ${fmtTime(data.compensation.newExpiresAt)}.`
      );
      setKeyId("");
      setTierHours("");
      await load();
    } catch (err) {
      setError(err?.message || "Gagal memberi kompensasi");
    } finally {
      setGranting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-text-main">Kompensasi Gangguan</h1>
        <p className="text-sm text-text-muted">
          Insiden dicatat otomatis oleh pemantau uptime gateway. Kompensasi berupa perpanjangan masa aktif kunci — diberikan manual oleh admin, tidak pernah otomatis.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-3 text-sm text-text-main">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-900/20 dark:border-green-800 p-3 text-sm text-text-main">
          {notice}
        </div>
      )}

      {/* Grant form */}
      <div className="bg-surface-2 border border-border-subtle rounded-lg p-4">
        <h2 className="mb-3 text-lg font-semibold text-text-main">Beri Kompensasi</h2>
        <form onSubmit={grant} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-muted">Insiden</span>
            <select
              value={incidentId}
              onChange={(e) => { setIncidentId(e.target.value); setTierHours(""); }}
              className="rounded-lg border border-border-subtle bg-surface px-3 py-2 text-text-main"
            >
              <option value="">— Pilih insiden —</option>
              {incidents.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.status === "open" ? "🔴 " : "✅ "}
                  {fmtDate(i.startedAt)} · {i.durationMinutes ?? "?"} menit · tier +{i.derivedTierHours}j · {i.compensationsGranted} diberi
                </option>
              ))}
            </select>
          </label>
          {selectedIncident && (
            <p className="text-xs text-text-muted">
              Durasi gangguan: {selectedIncident.durationMinutes ?? "?"} menit → tier dari durasi: +{derivedTier} jam.
              {selectedIncident.status === "open" ? " Insiden masih berlangsung — durasi dihitung sampai sekarang." : ""}
            </p>
          )}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-muted">Member</span>
            <select
              value={memberId}
              onChange={(e) => { setMemberId(e.target.value); setKeyId(""); }}
              className="rounded-lg border border-border-subtle bg-surface px-3 py-2 text-text-main"
            >
              <option value="">— Pilih member —</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name || m.email || m.id.slice(0, 8)}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-muted">Kunci</span>
            <select
              value={keyId}
              onChange={(e) => setKeyId(e.target.value)}
              disabled={!memberId}
              className="rounded-lg border border-border-subtle bg-surface px-3 py-2 text-text-main disabled:opacity-50"
            >
              <option value="">— Pilih kunci —</option>
              {memberKeys.map((k) => (
                <option key={k.id} value={k.id} disabled={!(k.isActive && k.expiresAt)}>
                  {k.name || "Unnamed"} — {k.isActive ? "aktif" : "nonaktif"}
                  {k.expiresAt ? ` · berakhir ${fmtTime(k.expiresAt)}` : " · tanpa masa berlaku (tidak bisa diberi kompensasi)"}
                </option>
              ))}
            </select>
          </label>
          {selectedKey && !keyEligible && (
            <p className="text-xs text-error">
              Kunci ini tidak bisa diberi kompensasi: {!selectedKey.isActive ? "kunci nonaktif. " : ""}
              {!selectedKey.expiresAt ? "kunci tanpa masa berlaku (expiresAt kosong) — perpanjangan tidak bisa diterapkan." : ""}
            </p>
          )}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-muted">Tier (jam tambahan)</span>
            <select
              value={tierHours}
              onChange={(e) => setTierHours(e.target.value)}
              className="rounded-lg border border-border-subtle bg-surface px-3 py-2 text-text-main"
            >
              <option value="">
                {derivedTier ? `Pakai tier dari durasi (+${derivedTier} jam)` : "— Pilih tier —"}
              </option>
              {TIERS.map((h) => (
                <option key={h} value={h}>+{h} jam{h === derivedTier ? " (tier dari durasi)" : ""}</option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={!incidentId || !keyId || !keyEligible || granting}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50 w-fit"
          >
            {granting ? "Memberi kompensasi…" : effectiveTier ? `Beri kompensasi +${effectiveTier} jam` : "Beri kompensasi"}
          </button>
        </form>
      </div>

      {/* Incidents */}
      <div className="bg-surface-2 border border-border-subtle rounded-lg p-4">
        <h2 className="mb-3 text-lg font-semibold text-text-main">Insiden</h2>
        {loading ? (
          <p className="text-sm text-text-muted">Memuat…</p>
        ) : incidents.length === 0 ? (
          <p className="text-sm text-text-muted">Belum ada insiden gangguan yang tercatat.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-muted">
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Mulai</th>
                  <th className="py-2 pr-3 font-medium">Selesai</th>
                  <th className="py-2 pr-3 font-medium">Durasi</th>
                  <th className="py-2 pr-3 font-medium">Penyebab</th>
                  <th className="py-2 pr-3 font-medium">Tier</th>
                  <th className="py-2 font-medium">Diberi</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((i) => (
                  <tr key={i.id} className="border-t border-border-subtle hover:bg-bg-subtle">
                    <td className="py-2 pr-3">{i.status === "open" ? "🔴 Berlangsung" : "✅ Selesai"}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{fmtTime(i.startedAt)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{i.endedAt ? fmtTime(i.endedAt) : "—"}</td>
                    <td className="py-2 pr-3">{i.durationMinutes ?? "?"} mnt</td>
                    <td className="py-2 pr-3">{i.reason || "-"}</td>
                    <td className="py-2 pr-3">+{i.derivedTierHours} jam</td>
                    <td className="py-2">{i.compensationsGranted} kunci</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Granted compensations */}
      <div className="bg-surface-2 border border-border-subtle rounded-lg p-4">
        <h2 className="mb-3 text-lg font-semibold text-text-main">Kompensasi yang Diberikan</h2>
        {compensations.length === 0 ? (
          <p className="text-sm text-text-muted">Belum ada kompensasi yang diberikan.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-muted">
                  <th className="py-2 pr-3 font-medium">Diberikan</th>
                  <th className="py-2 pr-3 font-medium">Tambahan</th>
                  <th className="py-2 pr-3 font-medium">Kunci</th>
                  <th className="py-2 pr-3 font-medium">Insiden</th>
                  <th className="py-2 font-medium">Masa berlaku baru</th>
                </tr>
              </thead>
              <tbody>
                {compensations.map((c) => (
                  <tr key={c.id} className="border-t border-border-subtle hover:bg-bg-subtle">
                    <td className="py-2 pr-3 whitespace-nowrap">{fmtTime(c.grantedAt)}</td>
                    <td className="py-2 pr-3">+{c.amount} jam</td>
                    <td className="py-2 pr-3 font-mono text-xs">{c.keyId.slice(0, 8)}</td>
                    <td className="py-2 pr-3">
                      {c.incidentStartedAt ? fmtDate(c.incidentStartedAt) : c.incidentId.slice(0, 8)}
                      {c.incidentDurationMinutes != null ? ` (${c.incidentDurationMinutes} mnt)` : ""}
                    </td>
                    <td className="py-2 whitespace-nowrap">{c.newExpiresAt ? fmtTime(c.newExpiresAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
