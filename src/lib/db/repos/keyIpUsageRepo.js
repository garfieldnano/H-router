import { getAdapter } from "../driver.js";
import { IP_CAP_WINDOW_MS } from "@/shared/utils/ipCap.js";

// Active IP usage (plan #5, schema v9): one row per (key, client IP).
// lastSeenAt is refreshed on every /v1 request from that IP. All timestamps
// are ISO strings; the sliding window is computed in JS (lexicographic ISO
// comparison equals chronological order for same-format UTC strings).

function cutoffIso(nowMs = Date.now()) {
  return new Date(nowMs - IP_CAP_WINDOW_MS).toISOString();
}

/** Record (or refresh) one IP sighting for a key. */
export async function recordIpUsage(keyId, ip, nowMs = Date.now()) {
  if (!keyId || !ip) return null;
  const db = await getAdapter();
  const now = new Date(nowMs).toISOString();
  db.run(
    `INSERT INTO key_ip_usage(keyId, ip, lastSeenAt) VALUES(?, ?, ?)
     ON CONFLICT(keyId, ip) DO UPDATE SET lastSeenAt = excluded.lastSeenAt`,
    [keyId, ip, now]
  );
  return { keyId, ip, lastSeenAt: now };
}

/** Distinct IPs for a key seen inside the sliding window (newest first). */
export async function getActiveIps(keyId, nowMs = Date.now()) {
  if (!keyId) return [];
  const db = await getAdapter();
  const rows = db.all(
    `SELECT ip, lastSeenAt FROM key_ip_usage
     WHERE keyId = ? AND lastSeenAt > ?
     ORDER BY lastSeenAt DESC`,
    [keyId, cutoffIso(nowMs)]
  );
  return rows.map((r) => ({ ip: r.ip, lastSeenAt: r.lastSeenAt }));
}

/** Count of distinct active IPs for a key (inside the window). */
export async function countActiveIps(keyId, nowMs = Date.now()) {
  if (!keyId) return 0;
  const db = await getAdapter();
  const row = db.get(
    `SELECT COUNT(*) AS n FROM key_ip_usage WHERE keyId = ? AND lastSeenAt > ?`,
    [keyId, cutoffIso(nowMs)]
  );
  return row?.n ?? 0;
}

/** Oldest in-window sighting for a key (drives Retry-After), or null. */
export async function getOldestActiveIp(keyId, nowMs = Date.now()) {
  if (!keyId) return null;
  const db = await getAdapter();
  const row = db.get(
    `SELECT ip, lastSeenAt FROM key_ip_usage
     WHERE keyId = ? AND lastSeenAt > ?
     ORDER BY lastSeenAt ASC LIMIT 1`,
    [keyId, cutoffIso(nowMs)]
  );
  return row ? { ip: row.ip, lastSeenAt: row.lastSeenAt } : null;
}

/** Delete stale rows for one key (older than the window). Returns count. */
export async function pruneStaleIpUsageForKey(keyId, nowMs = Date.now()) {
  if (!keyId) return 0;
  const db = await getAdapter();
  const res = db.run(
    `DELETE FROM key_ip_usage WHERE keyId = ? AND lastSeenAt <= ?`,
    [keyId, cutoffIso(nowMs)]
  );
  return res?.changes ?? 0;
}

/** Delete ALL stale rows (periodic sweep). Returns count. */
export async function sweepStaleIpUsage(nowMs = Date.now()) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM key_ip_usage WHERE lastSeenAt <= ?`, [cutoffIso(nowMs)]);
  return res?.changes ?? 0;
}

/** Delete every row for a key (key deleted). Returns count. */
export async function deleteIpUsageForKey(keyId) {
  if (!keyId) return 0;
  const db = await getAdapter();
  const res = db.run(`DELETE FROM key_ip_usage WHERE keyId = ?`, [keyId]);
  return res?.changes ?? 0;
}
