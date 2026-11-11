import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { parseRpmLimit, TRIAL_DEFAULT_RPM } from "@/shared/utils/rpmLimit.js";

// Packages sold via the Telegram bot (and the web admin panel).
// Price is INTEGER rupiah (no decimals). type: 'paid' | 'trial'.
// Trial packages are free (price must be 0) and last durationDays (1 day).

export const PACKAGE_TYPES = ["paid", "trial"];

function rowToPackage(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    price: row.price ?? 0,
    durationDays: row.durationDays ?? 30,
    type: PACKAGE_TYPES.includes(row.type) ? row.type : "paid",
    access: parseJson(row.access, {}),
    // RPM (schema v5): default requests-per-minute for keys from this package.
    // NULL = inherit (trial → trial default 20, paid → global default 50).
    rpmLimit: row.rpmLimit ?? null,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function validatePackageInput(data, { partial = false } = {}) {
  const out = {};
  if (data.name !== undefined || !partial) {
    const name = typeof data.name === "string" ? data.name.trim() : "";
    if (!name) return { ok: false, error: "Nama paket diperlukan" };
    out.name = name;
  }
  if (data.price !== undefined || !partial) {
    const price = Number(data.price);
    if (!Number.isFinite(price) || price < 0 || !Number.isInteger(price)) {
      return { ok: false, error: "Harga harus bilangan bulat >= 0 (rupiah)" };
    }
    out.price = price;
  }
  if (data.durationDays !== undefined || !partial) {
    const days = Number(data.durationDays);
    if (!Number.isFinite(days) || days < 1 || !Number.isInteger(days)) {
      return { ok: false, error: "Durasi harus bilangan bulat >= 1 (hari)" };
    }
    out.durationDays = days;
  }
  if (data.type !== undefined || !partial) {
    if (!PACKAGE_TYPES.includes(data.type)) {
      return { ok: false, error: "type harus 'paid' atau 'trial'" };
    }
    out.type = data.type;
  }
  if (data.access !== undefined) {
    if (data.access !== null && typeof data.access !== "object") {
      return { ok: false, error: "access harus objek atau null" };
    }
    out.access = data.access || {};
  }
  if (data.rpmLimit !== undefined) {
    const checked = parseRpmLimit(data.rpmLimit);
    if (!checked.ok) return { ok: false, error: checked.error };
    out.rpmLimit = checked.value;
  }
  if (data.isActive !== undefined) out.isActive = data.isActive ? 1 : 0;
  return { ok: true, value: out };
}

export async function getPackages({ activeOnly = false } = {}) {
  const db = await getAdapter();
  const rows = activeOnly
    ? db.all(`SELECT * FROM packages WHERE isActive = 1 ORDER BY price ASC, createdAt ASC`)
    : db.all(`SELECT * FROM packages ORDER BY createdAt ASC`);
  return rows.map(rowToPackage);
}

export async function getPackageById(id) {
  if (!id) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM packages WHERE id = ?`, [id]);
  return rowToPackage(row);
}

export async function getActiveTrialPackage() {
  const db = await getAdapter();
  const row = db.get(
    `SELECT * FROM packages WHERE type = 'trial' AND isActive = 1 ORDER BY createdAt ASC LIMIT 1`
  );
  return rowToPackage(row);
}

export async function createPackage(data) {
  const checked = validatePackageInput(data);
  if (!checked.ok) throw new Error(checked.error);
  const v = checked.value;
  // Trial is always free — never charge for a trial package.
  if (v.type === "trial") v.price = 0;
  // Trial default RPM: a trial package with no rpmLimit set gets 20.
  if (v.type === "trial" && (v.rpmLimit === undefined || v.rpmLimit === null)) {
    v.rpmLimit = TRIAL_DEFAULT_RPM;
  }
  const now = new Date().toISOString();
  const pkg = {
    id: uuidv4(),
    name: v.name,
    price: v.price,
    durationDays: v.durationDays,
    type: v.type,
    access: v.access || {},
    rpmLimit: v.rpmLimit ?? null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  const db = await getAdapter();
  db.run(
    `INSERT INTO packages(id, name, price, durationDays, type, access, rpmLimit, isActive, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [pkg.id, pkg.name, pkg.price, pkg.durationDays, pkg.type, stringifyJson(pkg.access), pkg.rpmLimit, 1, pkg.createdAt, pkg.updatedAt]
  );
  return pkg;
}

export async function updatePackage(id, data) {
  const checked = validatePackageInput(data, { partial: true });
  if (!checked.ok) throw new Error(checked.error);
  const v = checked.value;
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM packages WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToPackage(row), ...v };
    if (merged.type === "trial") merged.price = 0;
    merged.updatedAt = new Date().toISOString();
    db.run(
      `UPDATE packages SET name = ?, price = ?, durationDays = ?, type = ?, access = ?, rpmLimit = ?, isActive = ?, updatedAt = ? WHERE id = ?`,
      [merged.name, merged.price, merged.durationDays, merged.type, stringifyJson(merged.access || {}), merged.rpmLimit ?? null, merged.isActive ? 1 : 0, merged.updatedAt, id]
    );
    result = rowToPackage(db.get(`SELECT * FROM packages WHERE id = ?`, [id]));
  });
  return result;
}

export async function deletePackage(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM packages WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}
