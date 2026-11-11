import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

// Downtime compensation (plan §0d, schema v6): gateway-uptime incidents
// recorded by the health prober + manual time-extension grants by admin.
// The grant itself (double-grant check + insert + key expiry extension)
// runs in one transaction in insertCompensationAndExtendKey(); the
// (incidentId, keyId) UNIQUE index is the backstop against races.

function rowToIncident(row) {
  if (!row) return null;
  return {
    id: row.id,
    scope: row.scope || "gateway",
    reason: row.reason || null,
    reasonDetail: row.reasonDetail || null,
    status: row.status,
    startedAt: row.startedAt,
    endedAt: row.endedAt || null,
    durationMinutes: row.durationMinutes ?? null,
    lastSeenAt: row.lastSeenAt || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToCompensation(row) {
  if (!row) return null;
  return {
    id: row.id,
    memberId: row.memberId || null,
    keyId: row.keyId,
    incidentId: row.incidentId,
    type: row.type || "hours",
    amount: row.amount,
    grantedAt: row.grantedAt,
    grantedBy: row.grantedBy || "admin",
    oldExpiresAt: row.oldExpiresAt || null,
    newExpiresAt: row.newExpiresAt || null,
  };
}

// ---------------------------------------------------------- incidents
export async function createIncident({ scope = "gateway", reason, reasonDetail, startedAt }) {
  const now = new Date().toISOString();
  const incident = {
    id: uuidv4(),
    scope,
    reason: reason || null,
    reasonDetail: reasonDetail || null,
    status: "open",
    startedAt: startedAt || now,
    endedAt: null,
    durationMinutes: null,
    lastSeenAt: startedAt || now,
    createdAt: now,
    updatedAt: now,
  };
  const db = await getAdapter();
  db.run(
    `INSERT INTO system_incidents(id, scope, reason, reasonDetail, status, startedAt, endedAt, durationMinutes, lastSeenAt, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [incident.id, incident.scope, incident.reason, incident.reasonDetail, incident.status, incident.startedAt, incident.endedAt, incident.durationMinutes, incident.lastSeenAt, incident.createdAt, incident.updatedAt]
  );
  return incident;
}

export async function getIncidentById(id) {
  if (!id) return null;
  const db = await getAdapter();
  return rowToIncident(db.get(`SELECT * FROM system_incidents WHERE id = ?`, [id]));
}

// At most one open incident per scope — the prober records into it while
// the outage continues; a new one only opens after the previous closes.
export async function getOpenIncident(scope = "gateway") {
  const db = await getAdapter();
  const row = db.get(
    `SELECT * FROM system_incidents WHERE scope = ? AND status = 'open' ORDER BY startedAt DESC LIMIT 1`,
    [scope]
  );
  return rowToIncident(row);
}

export async function getIncidents({ status, scope, limit = 50 } = {}) {
  const db = await getAdapter();
  const conds = [];
  const params = [];
  if (status) { conds.push("status = ?"); params.push(status); }
  if (scope) { conds.push("scope = ?"); params.push(scope); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = db.all(
    `SELECT * FROM system_incidents ${where} ORDER BY startedAt DESC LIMIT ?`,
    [...params, Math.max(1, Math.min(200, Number(limit) || 50))]
  );
  return rows.map(rowToIncident);
}

export async function updateIncidentLastSeen(id, lastSeenAt) {
  const db = await getAdapter();
  const res = db.run(
    `UPDATE system_incidents SET lastSeenAt = ?, updatedAt = ? WHERE id = ? AND status = 'open'`,
    [lastSeenAt, new Date().toISOString(), id]
  );
  return (res?.changes ?? 0) > 0;
}

// Close an open incident. durationMinutes = rounded minutes between
// startedAt and endedAt. Returns the closed incident (null if not open).
export async function closeIncident(id, endedAt) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM system_incidents WHERE id = ? AND status = 'open'`, [id]);
    if (!row) return;
    const end = endedAt || new Date().toISOString();
    const durationMinutes = Math.max(
      0,
      Math.round((new Date(end).getTime() - new Date(row.startedAt).getTime()) / 60000)
    );
    db.run(
      `UPDATE system_incidents SET status = 'closed', endedAt = ?, durationMinutes = ?, updatedAt = ? WHERE id = ?`,
      [end, durationMinutes, new Date().toISOString(), id]
    );
    result = rowToIncident(db.get(`SELECT * FROM system_incidents WHERE id = ?`, [id]));
  });
  return result;
}

// ---------------------------------------------------------- compensations
export async function getCompensationByIncidentAndKey(incidentId, keyId) {
  if (!incidentId || !keyId) return null;
  const db = await getAdapter();
  const row = db.get(
    `SELECT * FROM compensations WHERE incidentId = ? AND keyId = ?`,
    [incidentId, keyId]
  );
  return rowToCompensation(row);
}

export async function getCompensations({ memberId, keyId, incidentId, limit = 100 } = {}) {
  const db = await getAdapter();
  const conds = [];
  const params = [];
  if (memberId) { conds.push("memberId = ?"); params.push(memberId); }
  if (keyId) { conds.push("keyId = ?"); params.push(keyId); }
  if (incidentId) { conds.push("incidentId = ?"); params.push(incidentId); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = db.all(
    `SELECT * FROM compensations ${where} ORDER BY grantedAt DESC LIMIT ?`,
    [...params, Math.max(1, Math.min(500, Number(limit) || 100))]
  );
  return rows.map(rowToCompensation);
}

export async function getCompensationsByMemberId(memberId) {
  if (!memberId) return [];
  return getCompensations({ memberId });
}

export async function countCompensations({ incidentId, memberId } = {}) {
  const db = await getAdapter();
  const conds = [];
  const params = [];
  if (incidentId) { conds.push("incidentId = ?"); params.push(incidentId); }
  if (memberId) { conds.push("memberId = ?"); params.push(memberId); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const row = db.get(`SELECT COUNT(*) AS c FROM compensations ${where}`, params);
  return row?.c ?? 0;
}

// Atomic grant: re-check the double-grant guard inside the transaction,
// insert the compensation row, and extend the key's expiresAt — all or
// nothing. The UNIQUE index on (incidentId, keyId) is the race backstop;
// a constraint violation surfaces as an Error with code SQLITE_CONSTRAINT.
export async function insertCompensationAndExtendKey({ memberId, keyId, incidentId, amount, grantedBy = "admin", oldExpiresAt, newExpiresAt }) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const existing = db.get(
      `SELECT id FROM compensations WHERE incidentId = ? AND keyId = ?`,
      [incidentId, keyId]
    );
    if (existing) {
      const err = new Error("DUPLICATE_COMPENSATION");
      err.code = "DUPLICATE_COMPENSATION";
      throw err;
    }
    const now = new Date().toISOString();
    const comp = {
      id: uuidv4(),
      memberId: memberId || null,
      keyId,
      incidentId,
      type: "hours",
      amount: Number(amount),
      grantedAt: now,
      grantedBy,
      oldExpiresAt: oldExpiresAt || null,
      newExpiresAt: newExpiresAt || null,
    };
    db.run(
      `INSERT INTO compensations(id, memberId, keyId, incidentId, type, amount, grantedAt, grantedBy, oldExpiresAt, newExpiresAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [comp.id, comp.memberId, comp.keyId, comp.incidentId, comp.type, comp.amount, comp.grantedAt, comp.grantedBy, comp.oldExpiresAt, comp.newExpiresAt]
    );
    db.run(`UPDATE apiKeys SET expiresAt = ? WHERE id = ?`, [newExpiresAt || null, keyId]);
    result = comp;
  });
  return result;
}

// ---------------------------------------------------------- error rate
// Recent request error rate from usageHistory — the second detection signal
// (gateway reachable but erroring). status is 'ok' on success; anything
// else (incl. NULL) counts as an error.
export async function getRecentErrorRate(windowMinutes = 5) {
  const db = await getAdapter();
  const since = new Date(Date.now() - windowMinutes * 60000).toISOString();
  const row = db.get(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN COALESCE(status, 'ok') != 'ok' THEN 1 ELSE 0 END) AS errors
     FROM usageHistory WHERE timestamp >= ?`,
    [since]
  );
  const total = row?.total ?? 0;
  const errors = row?.errors ?? 0;
  return { total, errors, rate: total > 0 ? errors / total : 0, windowMinutes };
}
