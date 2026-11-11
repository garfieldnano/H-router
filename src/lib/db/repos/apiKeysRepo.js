import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { keyAccessFromColumns, keyAccessToColumns } from "@/shared/utils/keyAccess.js";
import { KEY_ACCESS_UNRESTRICTED } from "@/shared/constants/keyAccess.js";

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    memberId: row.memberId || null,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    // Optional expiry (ISO timestamp). NULL = never expires. Set for trial
    // keys issued by the Telegram bot; validateApiKey() rejects expired keys.
    expiresAt: row.expiresAt || null,
    // RPM (schema v5): per-key requests-per-minute. NULL = inherit from the
    // key's package, then the global default. No unlimited tier.
    rpmLimit: row.rpmLimit ?? null,
    // Active IP cap (schema v9, plan #5): max distinct client IPs in the
    // 10-minute window. NULL = the global default (3).
    maxIps: row.maxIps ?? null,
    // Package this key was issued from (schema v5). NULL = no package.
    packageId: row.packageId || null,
    access: keyAccessFromColumns(row.accessRestricted, row.accessAllow),
  };
}

export async function getApiKeys() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

// Used by the /v1 handlers to read the presented key's access settings.
export async function getApiKeyByKey(key) {
  if (!key) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
  return rowToKey(row);
}

export async function createApiKey(name, machineId) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    createdAt: new Date().toISOString(),
    access: { restricted: false, allow: [] },
  };
  const cols = keyAccessToColumns(KEY_ACCESS_UNRESTRICTED);
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, accessRestricted, accessAllow) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.createdAt, cols.accessRestricted, cols.accessAllow]
  );
  return apiKey;
}

export async function getApiKeysByMemberId(memberId) {
  if (!memberId) return [];
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM apiKeys WHERE memberId = ? ORDER BY createdAt ASC`, [memberId]);
  return rows.map(rowToKey);
}

// Assign (or unassign with null) an API key to a member. Admin-only callers.
export async function setApiKeyMember(id, memberId) {
  const db = await getAdapter();
  const res = db.run(`UPDATE apiKeys SET memberId = ? WHERE id = ?`, [memberId || null, id]);
  return (res?.changes ?? 0) > 0;
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToKey(row), ...data };
    const cols = keyAccessToColumns(merged.access);
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, memberId = ?, isActive = ?, expiresAt = ?, rpmLimit = ?, maxIps = ?, packageId = ?, accessRestricted = ?, accessAllow = ? WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, merged.memberId || null, merged.isActive ? 1 : 0, merged.expiresAt || null, merged.rpmLimit ?? null, merged.maxIps ?? null, merged.packageId || null, cols.accessRestricted, cols.accessAllow, id]
    );
    result = rowToKey(db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]));
  });
  return result;
}

// Set (or clear with null) the package a key was issued from. Used at
// issuance (bot order confirm / trial claim) and by the RPM resolver's lazy
// backfill for keys issued before apiKeys.packageId existed.
export async function setApiKeyPackage(id, packageId) {
  const db = await getAdapter();
  const res = db.run(`UPDATE apiKeys SET packageId = ? WHERE id = ?`, [packageId || null, id]);
  return (res?.changes ?? 0) > 0;
}

export async function setApiKeyExpiry(id, expiresAt) {
  const db = await getAdapter();
  const res = db.run(`UPDATE apiKeys SET expiresAt = ? WHERE id = ?`, [expiresAt || null, id]);
  return (res?.changes ?? 0) > 0;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT isActive, expiresAt FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  if (!(row.isActive === 1 || row.isActive === true)) return false;
  // Expired keys are rejected everywhere (member login, /v1 auth, guard).
  // NULL expiresAt = never expires (all pre-existing keys).
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) return false;
  return true;
}
