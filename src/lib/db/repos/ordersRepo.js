import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

// Orders placed via the Telegram bot (manual transfer + admin confirm).
// Status machine (see src/lib/bot/orderFlow.js — the single source of
// truth for allowed transitions; this repo only persists validated moves):
//   pending_payment -> pending_confirm -> confirmed | rejected

export const ORDER_STATUSES = ["pending_payment", "pending_confirm", "confirmed", "rejected"];

function rowToOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    buyerTelegramId: row.buyerTelegramId,
    buyerTelegramUsername: row.buyerTelegramUsername || null,
    buyerName: row.buyerName || null,
    packageId: row.packageId || null,
    packageName: row.packageName || null,
    amount: row.amount ?? 0,
    status: row.status,
    proofFileId: row.proofFileId || null,
    keyId: row.keyId || null,
    memberId: row.memberId || null,
    note: row.note || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createOrder({ buyerTelegramId, buyerTelegramUsername, buyerName, packageId, packageName, amount }) {
  if (!buyerTelegramId) throw new Error("buyerTelegramId is required");
  if (!packageId) throw new Error("packageId is required");
  const now = new Date().toISOString();
  const order = {
    id: uuidv4(),
    buyerTelegramId: String(buyerTelegramId),
    buyerTelegramUsername: buyerTelegramUsername || null,
    buyerName: buyerName || null,
    packageId,
    packageName: packageName || null,
    amount: Number(amount) || 0,
    status: "pending_payment",
    proofFileId: null,
    keyId: null,
    memberId: null,
    note: null,
    createdAt: now,
    updatedAt: now,
  };
  const db = await getAdapter();
  db.run(
    `INSERT INTO orders(id, buyerTelegramId, buyerTelegramUsername, buyerName, packageId, packageName, amount, status, proofFileId, keyId, memberId, note, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [order.id, order.buyerTelegramId, order.buyerTelegramUsername, order.buyerName, order.packageId, order.packageName, order.amount, order.status, order.proofFileId, order.keyId, order.memberId, order.note, order.createdAt, order.updatedAt]
  );
  return order;
}

export async function getOrderById(id) {
  if (!id) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM orders WHERE id = ?`, [id]);
  return rowToOrder(row);
}

// Latest CONFIRMED order that issued a key — used by the RPM resolver to
// derive a pre-v5 key's package (lazy backfill into apiKeys.packageId).
export async function getOrderByKeyId(keyId) {
  if (!keyId) return null;
  const db = await getAdapter();
  const row = db.get(
    `SELECT * FROM orders WHERE keyId = ? AND status = 'confirmed' ORDER BY createdAt DESC LIMIT 1`,
    [keyId]
  );
  return rowToOrder(row);
}

export async function getOrders({ status, buyerTelegramId, memberId, limit = 50 } = {}) {
  const db = await getAdapter();
  const conds = [];
  const params = [];
  if (status) { conds.push("status = ?"); params.push(status); }
  if (buyerTelegramId) { conds.push("buyerTelegramId = ?"); params.push(String(buyerTelegramId)); }
  if (memberId) { conds.push("memberId = ?"); params.push(memberId); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = db.all(
    `SELECT * FROM orders ${where} ORDER BY createdAt DESC LIMIT ?`,
    [...params, Math.max(1, Math.min(200, Number(limit) || 50))]
  );
  return rows.map(rowToOrder);
}

export async function getPendingOrders(limit = 50) {
  return getOrders({ status: "pending_confirm", limit });
}

export async function countOrders({ status } = {}) {
  const db = await getAdapter();
  const row = status
    ? db.get(`SELECT COUNT(*) AS c FROM orders WHERE status = ?`, [status])
    : db.get(`SELECT COUNT(*) AS c FROM orders`);
  return row?.c ?? 0;
}

export async function updateOrder(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM orders WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToOrder(row), ...data };
    merged.updatedAt = new Date().toISOString();
    db.run(
      `UPDATE orders SET status = ?, proofFileId = ?, keyId = ?, memberId = ?, note = ?, updatedAt = ? WHERE id = ?`,
      [merged.status, merged.proofFileId || null, merged.keyId || null, merged.memberId || null, merged.note || null, merged.updatedAt, id]
    );
    result = rowToOrder(db.get(`SELECT * FROM orders WHERE id = ?`, [id]));
  });
  return result;
}
