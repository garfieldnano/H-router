import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

// Telegram account linking + trial-claim guard.
// Link codes: short-lived (10 min), one-time, issued from the member
// dashboard. Trial claims: one row per Telegram user AND per member —
// the once-per-user guard lives here (UNIQUE telegramId).

const LINK_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
export const LINK_CODE_TTL_MS = 10 * 60 * 1000;

export function generateLinkCode(randomFn = Math.random) {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += LINK_CODE_CHARS.charAt(Math.floor(randomFn() * LINK_CODE_CHARS.length));
  }
  return code;
}

export async function createLinkCode(memberId, { ttlMs = LINK_CODE_TTL_MS } = {}) {
  if (!memberId) throw new Error("memberId is required");
  const db = await getAdapter();
  const now = new Date();
  const code = generateLinkCode();
  const link = {
    code,
    memberId,
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    usedAt: null,
    createdAt: now.toISOString(),
  };
  db.run(
    `INSERT INTO telegramLinks(code, memberId, expiresAt, usedAt, createdAt) VALUES(?, ?, ?, ?, ?)`,
    [link.code, link.memberId, link.expiresAt, null, link.createdAt]
  );
  return link;
}

/** Consume a link code (marks it used). Returns { memberId } or null. */
export async function consumeLinkCode(code) {
  if (!code || typeof code !== "string") return null;
  const clean = code.trim().toUpperCase();
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM telegramLinks WHERE code = ?`, [clean]);
    if (!row) return;
    if (row.usedAt) return; // already used
    if (new Date(row.expiresAt).getTime() < Date.now()) return; // expired
    db.run(`UPDATE telegramLinks SET usedAt = ? WHERE code = ?`, [new Date().toISOString(), clean]);
    result = { memberId: row.memberId, code: clean };
  });
  return result;
}

export async function linkChat({ chatId, memberId, username, firstName }) {
  if (!chatId) throw new Error("chatId is required");
  const now = new Date().toISOString();
  const db = await getAdapter();
  // One chat = one member at most; re-linking moves the chat to the new member.
  db.run(
    `INSERT INTO telegramChats(chatId, memberId, username, firstName, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(chatId) DO UPDATE SET memberId = excluded.memberId, username = excluded.username, firstName = excluded.firstName, updatedAt = excluded.updatedAt`,
    [String(chatId), memberId || null, username || null, firstName || null, now, now]
  );
  return getChatById(chatId);
}

export async function getChatById(chatId) {
  if (chatId === undefined || chatId === null || chatId === "") return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM telegramChats WHERE chatId = ?`, [String(chatId)]);
  if (!row) return null;
  return {
    chatId: row.chatId,
    memberId: row.memberId || null,
    username: row.username || null,
    firstName: row.firstName || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getChatByMemberId(memberId) {
  if (!memberId) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM telegramChats WHERE memberId = ? ORDER BY updatedAt DESC LIMIT 1`, [memberId]);
  if (!row) return null;
  return {
    chatId: row.chatId,
    memberId: row.memberId || null,
    username: row.username || null,
    firstName: row.firstName || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getTrialClaimByTelegramId(telegramId) {
  if (!telegramId) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM trialClaims WHERE telegramId = ?`, [String(telegramId)]);
  if (!row) return null;
  return {
    id: row.id,
    telegramId: row.telegramId,
    memberId: row.memberId,
    keyId: row.keyId,
    claimedAt: row.claimedAt,
    expiresAt: row.expiresAt,
  };
}

export async function getTrialClaimByMemberId(memberId) {
  if (!memberId) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM trialClaims WHERE memberId = ?`, [memberId]);
  if (!row) return null;
  return {
    id: row.id,
    telegramId: row.telegramId,
    memberId: row.memberId,
    keyId: row.keyId,
    claimedAt: row.claimedAt,
    expiresAt: row.expiresAt,
  };
}

// Trial claim for a key — used by the RPM resolver to derive a pre-v5 trial
// key's package (lazy backfill into apiKeys.packageId).
export async function getTrialClaimByKeyId(keyId) {
  if (!keyId) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM trialClaims WHERE keyId = ?`, [keyId]);
  if (!row) return null;
  return {
    id: row.id,
    telegramId: row.telegramId,
    memberId: row.memberId,
    keyId: row.keyId,
    claimedAt: row.claimedAt,
    expiresAt: row.expiresAt,
  };
}

export async function createTrialClaim({ telegramId, memberId, keyId, expiresAt }) {
  if (!telegramId || !memberId || !keyId || !expiresAt) {
    throw new Error("telegramId, memberId, keyId, expiresAt are required");
  }
  const now = new Date().toISOString();
  const claim = {
    id: uuidv4(),
    telegramId: String(telegramId),
    memberId,
    keyId,
    claimedAt: now,
    expiresAt,
  };
  const db = await getAdapter();
  db.run(
    `INSERT INTO trialClaims(id, telegramId, memberId, keyId, claimedAt, expiresAt) VALUES(?, ?, ?, ?, ?, ?)`,
    [claim.id, claim.telegramId, claim.memberId, claim.keyId, claim.claimedAt, claim.expiresAt]
  );
  return claim;
}
