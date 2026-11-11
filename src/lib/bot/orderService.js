// Server-side bot service — order confirm / trial claim / trial sweep.
// Called ONLY by the internal /api/bot/* routes (service-secret guarded).
// The bot process itself never touches the DB; it only calls those routes.

import {
  getPackageById, getActiveTrialPackage,
  getOrderById, updateOrder,
  getMemberById, createMember,
  createApiKey, updateApiKey, setApiKeyExpiry,
  getChatById, getChatByMemberId,
  getTrialClaimByTelegramId, getTrialClaimByMemberId, createTrialClaim,
  getApiKeysByMemberId,
} from "@/lib/localDb.js";
import { getConsistentMachineId } from "@/shared/utils/machineId.js";
import { canTransition } from "./orderFlow.js";
import { trialEligibility, trialDurationDays } from "./trial.js";

export const TRIAL_KEY_NAME_PREFIX = "Trial Telegram";

/** Synthetic contact email for members auto-created from Telegram orders. */
export function telegramMemberEmail(telegramId) {
  return `tg-${String(telegramId)}@telegram.local`;
}

async function issueKey({ memberId, name, durationDays, packageId }) {
  const machineId = await getConsistentMachineId();
  const apiKey = await createApiKey(name, machineId);
  // createApiKey does not set memberId; assign it (and expiry for trials).
  const { setApiKeyMember, setApiKeyPackage } = await import("@/lib/localDb.js");
  await setApiKeyMember(apiKey.id, memberId);
  // RPM (schema v5): record which package issued this key so the per-package
  // RPM level of the chain resolves without an orders lookup.
  if (packageId) await setApiKeyPackage(apiKey.id, packageId);
  if (durationDays && durationDays > 0) {
    const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();
    await setApiKeyExpiry(apiKey.id, expiresAt);
    apiKey.expiresAt = expiresAt;
  }
  apiKey.memberId = memberId;
  apiKey.packageId = packageId || null;
  return apiKey;
}

export async function findOrCreateMemberFromTelegram({ telegramId, username, firstName }) {
  const chat = await getChatById(telegramId);
  if (chat?.memberId) {
    const member = await getMemberById(chat.memberId);
    if (member) return { member, created: false };
  }
  const name = firstName || username || `Telegram ${telegramId}`;
  const member = await createMember({ name, email: telegramMemberEmail(telegramId) });
  return { member, created: true };
}

// ---------------------------------------------------------- order confirm

export async function confirmOrder(orderId, { note } = {}) {
  const order = await getOrderById(orderId);
  if (!order) return { ok: false, error: "Order tidak ditemukan", status: 404 };
  if (!canTransition(order.status, "confirmed")) {
    return { ok: false, error: `Order sudah ${order.status}, tidak bisa dikonfirmasi`, status: 409 };
  }
  const pkg = await getPackageById(order.packageId);
  if (!pkg) return { ok: false, error: "Paket order tidak ditemukan", status: 404 };
  if (!pkg.isActive) return { ok: false, error: "Paket sudah tidak aktif", status: 409 };

  // Member: the order's member, the linked chat's member, or auto-create.
  let member = null;
  if (order.memberId) member = await getMemberById(order.memberId);
  if (!member) {
    const found = await findOrCreateMemberFromTelegram({
      telegramId: order.buyerTelegramId,
      username: order.buyerTelegramUsername,
      firstName: order.buyerName,
    });
    member = found.member;
  }
  if (!member?.isActive) return { ok: false, error: "Member tidak aktif", status: 409 };

  const apiKey = await issueKey({
    memberId: member.id,
    name: `${pkg.name} — Telegram @${order.buyerTelegramUsername || order.buyerTelegramId}`,
    durationDays: pkg.durationDays,
    packageId: pkg.id,
  });
  const updated = await updateOrder(order.id, {
    status: "confirmed",
    keyId: apiKey.id,
    memberId: member.id,
    note: note || null,
  });
  return { ok: true, order: updated, member, apiKey, pkg };
}

export async function rejectOrder(orderId, { note } = {}) {
  const order = await getOrderById(orderId);
  if (!order) return { ok: false, error: "Order tidak ditemukan", status: 404 };
  if (!canTransition(order.status, "rejected")) {
    return { ok: false, error: `Order sudah ${order.status}, tidak bisa ditolak`, status: 409 };
  }
  const updated = await updateOrder(order.id, { status: "rejected", note: note || null });
  return { ok: true, order: updated };
}

// ------------------------------------------------------------- trial claim

export async function claimTrial({ telegramId, username, firstName }) {
  const pkg = await getActiveTrialPackage();
  const telegramClaim = await getTrialClaimByTelegramId(telegramId);
  const chat = await getChatById(telegramId);
  const memberClaim = chat?.memberId ? await getTrialClaimByMemberId(chat.memberId) : null;
  const check = trialEligibility({ telegramClaim, memberClaim, trialPackage: pkg });
  if (!check.ok) return { ok: false, error: check.message, reason: check.reason, status: 409 };

  const { member } = await findOrCreateMemberFromTelegram({ telegramId, username, firstName });
  if (!member?.isActive) return { ok: false, error: "Member tidak aktif", status: 409 };

  const days = trialDurationDays(pkg);
  const apiKey = await issueKey({
    memberId: member.id,
    name: `${TRIAL_KEY_NAME_PREFIX} — ${pkg.name} (@${username || telegramId})`,
    durationDays: days,
    packageId: pkg.id,
  });
  const claim = await createTrialClaim({
    telegramId,
    memberId: member.id,
    keyId: apiKey.id,
    expiresAt: apiKey.expiresAt,
  });
  return { ok: true, member, apiKey, claim, pkg };
}

// ------------------------------------------------------------ trial sweep

/**
 * Deactivate trial keys whose expiry has passed. Returns the deactivated
 * keys with their member + Telegram chat so the bot can notify the member.
 * validateApiKey() already rejects expired keys; this is hygiene + notice.
 */
export async function sweepExpiredTrialKeys() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  const now = new Date().toISOString();
  const rows = db.all(
    `SELECT tc.telegramId AS telegramId, tc.memberId AS memberId, tc.keyId AS keyId, tc.expiresAt AS expiresAt, ak.key AS apiKey
     FROM trialClaims tc JOIN apiKeys ak ON ak.id = tc.keyId
     WHERE tc.expiresAt <= ? AND ak.isActive = 1`,
    [now]
  );
  const deactivated = [];
  for (const row of rows) {
    await updateApiKey(row.keyId, { isActive: false });
    const chat = await getChatByMemberId(row.memberId);
    deactivated.push({
      telegramId: row.telegramId,
      memberId: row.memberId,
      keyId: row.keyId,
      expiresAt: row.expiresAt,
      chatId: chat?.chatId || null,
    });
  }
  return deactivated;
}

export async function getMemberKeysForBot(memberId) {
  const { getKeyRateStatus } = await import("@/sse/services/keyRateLimit.js");
  const keys = await getApiKeysByMemberId(memberId);
  return Promise.all(keys.map(async (k) => {
    const rate = await getKeyRateStatus(k.id).catch(() => null);
    return {
      id: k.id,
      name: k.name,
      maskedKey: k.key ? `${k.key.slice(0, 8)}***${k.key.slice(-4)}` : null,
      isActive: k.isActive,
      createdAt: k.createdAt,
      expiresAt: k.expiresAt || null,
      // RPM (schema v5): per-key override (null = inherit) + effective limit
      // with current-minute usage, for the member menu (read-only).
      rpmLimit: k.rpmLimit ?? null,
      packageId: k.packageId || null,
      rate: rate
        ? { limit: rate.limit, source: rate.source, packageName: rate.packageName, used: rate.used, remaining: rate.remaining }
        : null,
    };
  }));
}
