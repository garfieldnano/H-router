import { getAdapter } from "../driver.js";

// Egress relay state (plan #1, schema v7): per-pool ban/health state for the
// egress rotator. One row per proxy pool id; a pool with no row has never
// been banned. All timestamps are ISO strings; bannedUntil in the future
// means the pool is on cooldown and the rotator must skip it.

function rowToRelay(row) {
  if (!row) return null;
  return {
    poolId: row.poolId,
    bannedUntil: row.bannedUntil || null,
    lastBanAt: row.lastBanAt || null,
    lastBanStatus: row.lastBanStatus ?? null,
    lastBanCode: row.lastBanCode || null,
    failCount: row.failCount ?? 0,
    lastSuccessAt: row.lastSuccessAt || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getRelayState(poolId) {
  if (!poolId) return null;
  const db = await getAdapter();
  return rowToRelay(db.get(`SELECT * FROM egress_relays WHERE poolId = ?`, [poolId]));
}

export async function getRelayStates(poolIds = null) {
  const db = await getAdapter();
  if (Array.isArray(poolIds) && poolIds.length > 0) {
    const placeholders = poolIds.map(() => "?").join(", ");
    return db.all(`SELECT * FROM egress_relays WHERE poolId IN (${placeholders})`, poolIds).map(rowToRelay);
  }
  return db.all(`SELECT * FROM egress_relays`).map(rowToRelay);
}

// True when the pool is currently on cooldown (bannedUntil in the future).
export function isRelayBanned(state, nowMs = Date.now()) {
  if (!state?.bannedUntil) return false;
  return new Date(state.bannedUntil).getTime() > nowMs;
}

// Pool ids (from the given list) that are currently banned.
export async function getBannedRelayPoolIds(poolIds = []) {
  if (!Array.isArray(poolIds) || poolIds.length === 0) return [];
  const states = await getRelayStates(poolIds);
  const now = Date.now();
  return states.filter((s) => isRelayBanned(s, now)).map((s) => s.poolId);
}

// Record a ban: bump failCount, stamp lastBan*, set bannedUntil = now +
// cooldownMs. Creates the row when the pool has never been banned.
export async function markRelayBanned(poolId, { status, code, cooldownMs }) {
  if (!poolId) return null;
  const db = await getAdapter();
  const now = new Date().toISOString();
  const bannedUntil = new Date(Date.now() + Math.max(0, Number(cooldownMs) || 0)).toISOString();
  let result = null;
  db.transaction(() => {
    const existing = db.get(`SELECT * FROM egress_relays WHERE poolId = ?`, [poolId]);
    if (existing) {
      db.run(
        `UPDATE egress_relays SET bannedUntil = ?, lastBanAt = ?, lastBanStatus = ?, lastBanCode = ?, failCount = ?, updatedAt = ? WHERE poolId = ?`,
        [bannedUntil, now, status ?? null, code ?? null, (existing.failCount ?? 0) + 1, now, poolId]
      );
    } else {
      db.run(
        `INSERT INTO egress_relays(poolId, bannedUntil, lastBanAt, lastBanStatus, lastBanCode, failCount, lastSuccessAt, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [poolId, bannedUntil, now, status ?? null, code ?? null, 1, null, now, now]
      );
    }
    result = rowToRelay(db.get(`SELECT * FROM egress_relays WHERE poolId = ?`, [poolId]));
  });
  return result;
}

// Record a success through the pool: clear the ban streak (failCount → 0)
// and stamp lastSuccessAt. Does NOT clear bannedUntil early — a ban
// cooldown still runs its course even if a later request slips through.
export async function recordRelaySuccess(poolId) {
  if (!poolId) return null;
  const db = await getAdapter();
  const now = new Date().toISOString();
  let result = null;
  db.transaction(() => {
    const existing = db.get(`SELECT * FROM egress_relays WHERE poolId = ?`, [poolId]);
    if (existing) {
      db.run(
        `UPDATE egress_relays SET failCount = 0, lastSuccessAt = ?, updatedAt = ? WHERE poolId = ?`,
        [now, now, poolId]
      );
    } else {
      db.run(
        `INSERT INTO egress_relays(poolId, bannedUntil, lastBanAt, lastBanStatus, lastBanCode, failCount, lastSuccessAt, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [poolId, null, null, null, null, 0, now, now, now]
      );
    }
    result = rowToRelay(db.get(`SELECT * FROM egress_relays WHERE poolId = ?`, [poolId]));
  });
  return result;
}

// Admin override: clear a ban immediately (failCount reset, bannedUntil NULL).
export async function clearRelayBan(poolId) {
  if (!poolId) return null;
  const db = await getAdapter();
  const now = new Date().toISOString();
  let result = null;
  db.transaction(() => {
    const existing = db.get(`SELECT * FROM egress_relays WHERE poolId = ?`, [poolId]);
    if (!existing) return;
    db.run(
      `UPDATE egress_relays SET bannedUntil = NULL, failCount = 0, updatedAt = ? WHERE poolId = ?`,
      [now, poolId]
    );
    result = rowToRelay(db.get(`SELECT * FROM egress_relays WHERE poolId = ?`, [poolId]));
  });
  return result;
}
