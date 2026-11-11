// Downtime compensation (plan §0d) — pure logic, no imports beyond the
// formatting helpers, no DB, no Telegraf. Importable by the standalone bot
// process (plain node, relative import), by Next.js API routes, and by
// vitest. The canonical module is this .mjs file; compensation.js re-exports
// it for the Next.js (@/lib/bot/...) import path.

import { fmtDateWib } from "./format.mjs";

// ---------------------------------------------------------- tiers
// Outage duration → extension hours. The tier is the UPPER bound of the
// outage-duration band (decided by the user 22:44 WIB):
//   < 1h  → +1h · 1–3h → +3h · 3–5h → +5h · > 5h → +8h.
// Boundary values belong to the band that STARTS there: exactly 60 min is
// the 1–3h band (+3h), exactly 180 min is +3h, exactly 300 min is +5h.
export const COMPENSATION_TIERS = [
  { maxOutageMinutes: 60, hours: 1 },
  { maxOutageMinutes: 180, hours: 3 },
  { maxOutageMinutes: 300, hours: 5 },
  { maxOutageMinutes: Infinity, hours: 8 },
];

export const COMPENSATION_TIER_HOURS = [1, 3, 5, 8];

export function tierForOutageMinutes(durationMinutes) {
  const d = Math.max(0, Number(durationMinutes) || 0);
  // Bands are [0,60) → 1 · [60,180] → 3 · (180,300] → 5 · (300,∞) → 8.
  // Exact boundaries belong to the band that STARTS (60) or ENDS there
  // (180, 300) as decided: 60 min = 1–3h band (+3h), 180 min = +3h,
  // 300 min = +5h.
  if (d < 60) return 1;
  if (d <= 180) return 3;
  if (d <= 300) return 5;
  return 8;
}

export function isValidTierHours(hours) {
  return COMPENSATION_TIER_HOURS.includes(Number(hours));
}

// Extend an expiry by N hours. If the key already expired, the extension
// runs from NOW (not from the past expiry) — otherwise a grant to an
// expired key would leave it expired and do nothing.
export function extendExpiry(expiresAtIso, hours, now = new Date()) {
  const base = Math.max(new Date(expiresAtIso).getTime(), now.getTime());
  return new Date(base + Number(hours) * 3600_000).toISOString();
}

// Duration of an incident in whole minutes (rounded). An open incident
// measures from startedAt to now; a closed one to endedAt.
export function incidentDurationMinutes(incident, now = new Date()) {
  if (!incident?.startedAt) return 0;
  const start = new Date(incident.startedAt).getTime();
  const end = incident.endedAt ? new Date(incident.endedAt).getTime() : now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 60000));
}

// ---------------------------------------------------------- detector
// Minimal gateway-uptime detector (the full health scanner is feature #5).
// Two signals: the /api/health probe (unreachable / non-OK) and the recent
// request error rate from usageHistory (gateway up but erroring).
export const PROBE_INTERVAL_MS = 60_000; // probe the gateway every minute
export const PROBE_FAILURES_TO_OPEN = 3; // 3 consecutive failures = incident
export const PROBE_TIMEOUT_MS = 10_000;
export const ERROR_RATE_THRESHOLD = 0.5; // > 50% errors in the window = down
export const ERROR_RATE_WINDOW_MINUTES = 5;
export const ERROR_RATE_MIN_REQUESTS = 10; // too few requests = inconclusive

export function evaluateErrorRate({ total, errors }) {
  const t = Number(total) || 0;
  const e = Number(errors) || 0;
  const rate = t > 0 ? e / t : 0;
  return {
    total: t,
    errors: e,
    rate,
    isDown: t >= ERROR_RATE_MIN_REQUESTS && rate > ERROR_RATE_THRESHOLD,
  };
}

// ---------------------------------------------------------- rendering
export function renderIncident(incident, { compensations = [], derivedTier = null } = {}) {
  const duration = incidentDurationMinutes(incident);
  const tier = derivedTier ?? tierForOutageMinutes(duration);
  const lines = [
    `🚨 *Insiden ${incident.id.slice(0, 8)}* — ${incident.status === "open" ? "🔴 BERLANGSUNG" : "✅ Selesai"}`,
    ``,
    `Cakupan: ${incident.scope === "gateway" ? "Gateway" : incident.scope}`,
    `Penyebab: ${incident.reason || "-"}${incident.reasonDetail ? ` (${incident.reasonDetail})` : ""}`,
    `Mulai: ${fmtDateWib(incident.startedAt)}`,
    incident.endedAt ? `Selesai: ${fmtDateWib(incident.endedAt)}` : `Terakhir terlihat gagal: ${incident.lastSeenAt ? fmtDateWib(incident.lastSeenAt) : "-"}`,
    `Durasi: ${duration} menit`,
    `Tier kompensasi: +${tier} jam`,
    `Kompensasi diberikan: ${compensations.length} kunci`,
  ];
  return lines.join("\n");
}

export function renderCompensationHistory(list) {
  if (!list?.length) return "🎁 *Riwayat Kompensasi*\n\nBelum ada kompensasi yang diberikan ke kunci kamu.";
  const lines = ["🎁 *Riwayat Kompensasi*", ""];
  for (const c of list) {
    lines.push(
      `• +${c.amount} jam — insiden ${String(c.incidentId).slice(0, 8)} · ${fmtDateWib(c.grantedAt)}` +
      (c.newExpiresAt ? `\n  Masa berlaku baru: ${fmtDateWib(c.newExpiresAt)}` : "")
    );
  }
  return lines.join("\n");
}
