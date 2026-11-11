"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Select, Table, Typography } from "antd";

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

const INCIDENT_COLUMNS = [
  {
    title: "Status",
    dataIndex: "status",
    key: "status",
    render: (s) => <Tag color={s === "open" ? "error" : "success"}>{s === "open" ? "Berlangsung" : "Selesai"}</Tag>,
  },
  { title: "Mulai", dataIndex: "startedAt", key: "startedAt", render: (v) => fmtTime(v) },
  { title: "Selesai", dataIndex: "endedAt", key: "endedAt", render: (v) => (v ? fmtTime(v) : "—") },
  { title: "Durasi", dataIndex: "durationMinutes", key: "duration", render: (v) => `${v ?? "?"} mnt` },
  { title: "Penyebab", dataIndex: "reason", key: "reason", render: (v) => v || "-" },
  { title: "Tier", dataIndex: "derivedTierHours", key: "tier", render: (v) => `+${v} jam` },
  { title: "Diberi", dataIndex: "compensationsGranted", key: "granted", render: (v) => `${v} kunci` },
];

const COMPENSATION_COLUMNS = [
  { title: "Diberikan", dataIndex: "grantedAt", key: "grantedAt", render: (v) => fmtTime(v) },
  { title: "Tambahan", dataIndex: "amount", key: "amount", render: (v) => `+${v} jam` },
  { title: "Kunci", dataIndex: "keyId", key: "keyId", render: (v) => <span className="font-mono text-xs">{(v || "").slice(0, 8)}</span> },
  {
    title: "Insiden",
    key: "incident",
    render: (_v, c) => (
      <span>
        {c.incidentStartedAt ? fmtDate(c.incidentStartedAt) : (c.incidentId || "").slice(0, 8)}
        {c.incidentDurationMinutes != null ? ` (${c.incidentDurationMinutes} mnt)` : ""}
      </span>
    ),
  },
  { title: "Masa berlaku baru", dataIndex: "newExpiresAt", key: "newExpiresAt", render: (v) => (v ? fmtTime(v) : "—") },
];

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
        <h1 className="text-xl font-semibold tracking-tight text-text-main">Kompensasi Gangguan</h1>
        <p className="text-sm text-text-muted">
          Insiden dicatat otomatis oleh pemantau uptime gateway. Kompensasi berupa perpanjangan masa aktif kunci — diberikan manual oleh admin, tidak pernah otomatis.
        </p>
      </div>

      {error && <Alert type="error" message={error} showIcon />}
      {notice && <Alert type="success" message={notice} showIcon />}

      {/* Grant form */}
      <Card title="Beri Kompensasi">
        <form onSubmit={grant} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-muted">Insiden</span>
            <Select
              value={incidentId || undefined}
              onChange={(v) => { setIncidentId(v); setTierHours(""); }}
              placeholder="— Pilih insiden —"
              options={incidents.map((i) => ({
                value: i.id,
                label: `${fmtDate(i.startedAt)} · ${i.durationMinutes ?? "?"} menit · tier +${i.derivedTierHours}j · ${i.compensationsGranted} diberi`,
              }))}
            />
          </label>
          {selectedIncident && (
            <Typography.Text type="secondary" className="text-xs">
              Durasi gangguan: {selectedIncident.durationMinutes ?? "?"} menit → tier dari durasi: +{derivedTier} jam.
              {selectedIncident.status === "open" ? " Insiden masih berlangsung — durasi dihitung sampai sekarang." : ""}
            </Typography.Text>
          )}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-muted">Member</span>
            <Select
              value={memberId || undefined}
              onChange={(v) => { setMemberId(v); setKeyId(""); }}
              placeholder="— Pilih member —"
              options={members.map((m) => ({
                value: m.id,
                label: m.name || m.email || m.id.slice(0, 8),
              }))}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-muted">Kunci</span>
            <Select
              value={keyId || undefined}
              onChange={setKeyId}
              disabled={!memberId}
              placeholder="— Pilih kunci —"
              options={memberKeys.map((k) => ({
                value: k.id,
                disabled: !(k.isActive && k.expiresAt),
                label: `${k.name || "Unnamed"} — ${k.isActive ? "aktif" : "nonaktif"}${k.expiresAt ? ` · berakhir ${fmtTime(k.expiresAt)}` : " · tanpa masa berlaku (tidak bisa diberi kompensasi)"}`,
              }))}
            />
          </label>
          {selectedKey && !keyEligible && (
            <Typography.Text type="danger" className="text-xs">
              Kunci ini tidak bisa diberi kompensasi: {!selectedKey.isActive ? "kunci nonaktif. " : ""}
              {!selectedKey.expiresAt ? "kunci tanpa masa berlaku (expiresAt kosong) — perpanjangan tidak bisa diterapkan." : ""}
            </Typography.Text>
          )}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-muted">Tier (jam tambahan)</span>
            <Select
              value={tierHours || undefined}
              onChange={setTierHours}
              placeholder={derivedTier ? `Pakai tier dari durasi (+${derivedTier} jam)` : "— Pilih tier —"}
              options={TIERS.map((h) => ({
                value: String(h),
                label: `+${h} jam${h === derivedTier ? " (tier dari durasi)" : ""}`,
              }))}
            />
          </label>
          <div>
            <Button
              type="primary"
              htmlType="submit"
              disabled={!incidentId || !keyId || !keyEligible || granting}
              loading={granting}
            >
              {granting ? "Memberi kompensasi…" : effectiveTier ? `Beri kompensasi +${effectiveTier} jam` : "Beri kompensasi"}
            </Button>
          </div>
        </form>
      </Card>

      {/* Incidents */}
      <Card title="Insiden">
        <Table
          columns={INCIDENT_COLUMNS}
          dataSource={incidents}
          rowKey="id"
          loading={loading}
          pagination={false}
          scroll={{ x: 800 }}
          locale={{ emptyText: "Belum ada insiden gangguan yang tercatat." }}
        />
      </Card>

      {/* Granted compensations */}
      <Card title="Kompensasi yang Diberikan">
        <Table
          columns={COMPENSATION_COLUMNS}
          dataSource={compensations}
          rowKey="id"
          loading={loading}
          pagination={false}
          scroll={{ x: 800 }}
          locale={{ emptyText: "Belum ada kompensasi yang diberikan." }}
        />
      </Card>
    </div>
  );
}
