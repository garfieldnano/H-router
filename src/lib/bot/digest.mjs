// Daily usage report — pure aggregation + WIB day boundaries.
// WIB is UTC+7 with no DST, so day boundaries are exact arithmetic.
// Rows: usageHistory rows { apiKey, model, promptTokens, completionTokens,
// cost, timestamp, status }.
// keyMeta: { [rawApiKey]: { memberId, memberName, keyName } } — resolves a
// raw key to its member for the "most active members/keys" ranking.

export const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
export const DIGEST_TIME_WIB = "08:00";

/** WIB date label for a Date: "2026-11-10" (the WIB calendar day). */
export function wibDateLabel(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return new Date(d.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Start/end (UTC ISO) of the WIB calendar day containing `date`.
 * WIB midnight = 17:00 UTC the previous day. End is exclusive.
 */
export function getWibDayBounds(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const wib = new Date(d.getTime() + WIB_OFFSET_MS);
  const y = wib.getUTCFullYear();
  const m = wib.getUTCMonth();
  const day = wib.getUTCDate();
  const startUtcMs = Date.UTC(y, m, day) - WIB_OFFSET_MS;
  return {
    label: wib.toISOString().slice(0, 10),
    start: new Date(startUtcMs).toISOString(),
    end: new Date(startUtcMs + 24 * 60 * 60 * 1000).toISOString(),
  };
}

/** Bounds of the PREVIOUS WIB day (what the morning digest reports on). */
export function getPreviousWibDayBounds(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  return getWibDayBounds(new Date(d.getTime() - 24 * 60 * 60 * 1000));
}

/** Milliseconds until the next 08:00 WIB from `now`. */
export function msUntilNextDigest(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  const wib = new Date(d.getTime() + WIB_OFFSET_MS);
  const next = new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate(), 8, 0, 0));
  if (next.getTime() <= wib.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - wib.getTime();
}

function emptyTotals() {
  return { requests: 0, promptTokens: 0, completionTokens: 0, tokens: 0, cost: 0 };
}

function addRow(t, row) {
  t.requests += 1;
  t.promptTokens += Number(row.promptTokens) || 0;
  t.completionTokens += Number(row.completionTokens) || 0;
  t.tokens += (Number(row.promptTokens) || 0) + (Number(row.completionTokens) || 0);
  t.cost += Number(row.cost) || 0;
}

/**
 * Admin daily digest for one WIB day.
 * topModels: ranked by requests, then tokens. topMembers/topKeys: ranked
 * by requests, then cost. Only rows with status "ok" count as successful
 * requests; the total counts every row (errors included) — both shown.
 */
export function buildDailyDigest(rows, keyMeta = {}, { label } = {}) {
  const totals = emptyTotals();
  let okRequests = 0;
  const byModel = new Map();
  const byMember = new Map();
  const byKey = new Map();

  for (const row of rows || []) {
    addRow(totals, row);
    if (row.status === "ok") okRequests += 1;
    const model = row.model || "(tanpa model)";
    if (!byModel.has(model)) byModel.set(model, { model, ...emptyTotals() });
    addRow(byModel.get(model), row);
    const meta = keyMeta[row.apiKey] || null;
    const memberKey = meta?.memberId || null;
    const memberName = meta?.memberName || "Tanpa member";
    if (!byMember.has(memberKey)) byMember.set(memberKey, { memberId: memberKey, memberName, ...emptyTotals() });
    addRow(byMember.get(memberKey), row);
    const keyLabel = meta?.keyName || maskShort(row.apiKey);
    if (!byKey.has(keyLabel)) byKey.set(keyLabel, { key: keyLabel, memberName, ...emptyTotals() });
    addRow(byKey.get(keyLabel), row);
  }

  const rank = (a, b) => b.requests - a.requests || b.tokens - a.tokens;
  return {
    label: label || wibDateLabel(),
    ...totals,
    okRequests,
    errorRequests: totals.requests - okRequests,
    topModels: [...byModel.values()].sort(rank).slice(0, 5),
    topMembers: [...byMember.values()].sort(rank).slice(0, 5),
    topKeys: [...byKey.values()].sort(rank).slice(0, 5),
  };
}

/** Member daily report for one WIB day (rows already scoped to the member). */
export function buildMemberDailyReport(rows, { label } = {}) {
  const totals = emptyTotals();
  const byModel = new Map();
  for (const row of rows || []) {
    addRow(totals, row);
    const model = row.model || "(tanpa model)";
    if (!byModel.has(model)) byModel.set(model, { model, ...emptyTotals() });
    addRow(byModel.get(model), row);
  }
  const rank = (a, b) => b.requests - a.requests || b.tokens - a.tokens;
  return { label: label || wibDateLabel(), ...totals, models: [...byModel.values()].sort(rank) };
}

function maskShort(key) {
  if (!key || typeof key !== "string") return "(tanpa kunci)";
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

export function renderDailyDigest(digest) {
  const d = digest;
  const lines = [
    `📬 *Laporan Harian — ${d.label} (WIB)*`,
    "",
    `Total request: ${fmtNum(d.requests)} (✅ ${fmtNum(d.okRequests)} · ❌ ${fmtNum(d.errorRequests)})`,
    `Total token: ${fmtNum(d.tokens)} (prompt ${fmtNum(d.promptTokens)} · completion ${fmtNum(d.completionTokens)})`,
    `Total biaya: ${fmtCost(d.cost)}`,
  ];
  if (d.topModels.length) {
    lines.push("", "🏆 *Top model:*");
    d.topModels.forEach((m, i) => {
      lines.push(`${i + 1}. ${m.model} — ${fmtNum(m.requests)} req · ${fmtNum(m.tokens)} token · ${fmtCost(m.cost)}`);
    });
  }
  if (d.topMembers.length) {
    lines.push("", "👥 *Member teraktif:*");
    d.topMembers.forEach((m, i) => {
      lines.push(`${i + 1}. ${m.memberName} — ${fmtNum(m.requests)} req · ${fmtNum(m.tokens)} token · ${fmtCost(m.cost)}`);
    });
  }
  if (d.topKeys.length) {
    lines.push("", "🔑 *Kunci teraktif:*");
    d.topKeys.forEach((k, i) => {
      lines.push(`${i + 1}. ${k.key} (${k.memberName}) — ${fmtNum(k.requests)} req · ${fmtNum(k.tokens)} token`);
    });
  }
  if (!d.requests) lines.push("", "_Tidak ada request pada hari ini._");
  return lines.join("\n");
}

export function renderMemberDailyReport(report) {
  const r = report;
  const lines = [
    `📊 *Laporan Harian — ${r.label} (WIB)*`,
    "",
    `Total request: ${fmtNum(r.requests)}`,
    `Total token: ${fmtNum(r.tokens)} (prompt ${fmtNum(r.promptTokens)} · completion ${fmtNum(r.completionTokens)})`,
    `Total biaya: ${fmtCost(r.cost)}`,
  ];
  if (r.models.length) {
    lines.push("", "Per model:");
    for (const m of r.models) {
      lines.push(`• ${m.model}: ${fmtNum(m.requests)} req · ${fmtNum(m.tokens)} token · ${fmtCost(m.cost)}`);
    }
  } else {
    lines.push("", "_Belum ada request hari ini._");
  }
  return lines.join("\n");
}
