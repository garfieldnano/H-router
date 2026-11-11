// Per-key RPM resolution + enforcement for the /v1 inference path.
//
// Priority chain (user decisions, plan §0c):
//   1. per-key   apiKeys.rpmLimit        (NULL = inherit)
//   2. per-package packages.rpmLimit     (NULL = inherit)
//   3. trial default 20                  (only when the key's package is a trial package)
//   4. global default settings.defaultRpmLimit (50)
// There is NO unlimited tier.
//
// Which keys are rate-limited:
//   * Every KNOWN, ACTIVE, UNEXPIRED key is limited (its effective limit
//     comes from the chain above; an admin key with no package and no
//     per-key limit gets the global default).
//   * NO key presented (local mode) → unlimited (nothing to count).
//   * UNKNOWN key → unlimited here (treated as "no key", same as keyAccess;
//     it is rejected with 401 elsewhere when requireApiKey is on).
//   * INACTIVE / EXPIRED key → unlimited here (rejected with 401 elsewhere).
//
// The check runs once per client request, right after the keyAccess gate in
// each /v1 handler — before bypass, combo expansion and any credential
// lookup, so an over-limit request never touches a provider account and a
// combo request counts as ONE request (not one per member model).
import { getApiKeyById, getApiKeyByKey, setApiKeyPackage } from "@/lib/db/repos/apiKeysRepo.js";
import { getPackageById, getActiveTrialPackage } from "@/lib/db/repos/packagesRepo.js";
import { getOrderByKeyId } from "@/lib/db/repos/ordersRepo.js";
import { getTrialClaimByKeyId } from "@/lib/db/repos/telegramRepo.js";
import { getSettings } from "@/lib/db/repos/settingsRepo.js";
import { extractClientApiKey } from "@/shared/utils/apiKey.js";
import { checkRateLimit, getRateUsage, rateLimitExceededResponse } from "./rateLimit.js";
import {
  GLOBAL_DEFAULT_RPM,
  RPM_MAX,
  RPM_MIN,
  TRIAL_DEFAULT_RPM,
} from "@/shared/utils/rpmLimit.js";
import * as log from "../utils/logger.js";

/** Normalize the global default from settings (out-of-range → 50). */
export function normalizeGlobalRpm(settings) {
  const v = Number(settings?.defaultRpmLimit);
  return Number.isInteger(v) && v >= RPM_MIN && v <= RPM_MAX ? v : GLOBAL_DEFAULT_RPM;
}

/**
 * Resolve the package a key was issued from.
 * Primary: apiKeys.packageId (set at issuance since schema v5).
 * Legacy: keys issued before that column existed are derived from the
 * confirmed order / trial claim that issued them, then persisted
 * (lazy backfill) so later requests need no extra lookup.
 */
export async function resolvePackageForKey(keyRecord) {
  if (!keyRecord) return null;
  if (keyRecord.packageId) {
    const pkg = await getPackageById(keyRecord.packageId);
    if (pkg) return pkg;
    // Package was deleted — fall through to legacy lookup, then global.
  }
  const order = await getOrderByKeyId(keyRecord.id).catch(() => null);
  if (order?.packageId) {
    const pkg = await getPackageById(order.packageId);
    if (pkg) {
      await setApiKeyPackage(keyRecord.id, pkg.id).catch(() => {});
      return pkg;
    }
  }
  const claim = await getTrialClaimByKeyId(keyRecord.id).catch(() => null);
  if (claim) {
    const pkg = await getActiveTrialPackage();
    if (pkg) {
      await setApiKeyPackage(keyRecord.id, pkg.id).catch(() => {});
      return pkg;
    }
  }
  return null;
}

/**
 * Effective RPM for a key record.
 * @returns {{ limit: number, source: "key"|"package"|"trial-default"|"global", packageId: string|null, packageName: string|null }}
 */
export async function resolveKeyRpmLimit(keyRecord, settingsOverride = null) {
  if (keyRecord?.rpmLimit != null) {
    return {
      limit: keyRecord.rpmLimit,
      source: "key",
      packageId: keyRecord.packageId || null,
      packageName: null,
    };
  }
  const pkg = await resolvePackageForKey(keyRecord);
  if (pkg?.rpmLimit != null) {
    return { limit: pkg.rpmLimit, source: "package", packageId: pkg.id, packageName: pkg.name };
  }
  if (pkg?.type === "trial") {
    return { limit: TRIAL_DEFAULT_RPM, source: "trial-default", packageId: pkg.id, packageName: pkg.name };
  }
  const settings = settingsOverride || (await getSettings());
  return {
    limit: normalizeGlobalRpm(settings),
    source: "global",
    packageId: pkg?.id || null,
    packageName: pkg?.name || null,
  };
}

/**
 * Gate for /v1 handlers. Call once per request, after the keyAccess gate.
 * @returns {Promise<Response|null>} a 429 Response when over the limit, else null.
 */
export async function enforceKeyRateLimit(request) {
  const apiKey = extractClientApiKey(request);
  if (!apiKey) return null;
  const record = await getApiKeyByKey(apiKey);
  if (!record || !record.isActive) return null;
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) return null;
  const resolved = await resolveKeyRpmLimit(record);
  const result = checkRateLimit(record.id, resolved.limit);
  if (!result.allowed) {
    log.warn(
      "AUTH",
      `rate-limit: key "${record.name || record.id}" exceeded ${resolved.limit}/min (source: ${resolved.source}, used: ${result.used})`
    );
    return rateLimitExceededResponse({
      limit: resolved.limit,
      used: result.used,
      retryAfterSec: result.retryAfterSec,
    });
  }
  return null;
}

/**
 * Current RPM status of a key (for the member dashboard / bot member menu).
 * @returns {Promise<{ keyId, limit, source, packageId, packageName, used, remaining, resetAtMs }|null>}
 */
export async function getKeyRateStatus(keyId) {
  const record = await getApiKeyById(keyId);
  if (!record) return null;
  const resolved = await resolveKeyRpmLimit(record);
  const usage = getRateUsage(record.id);
  return {
    keyId: record.id,
    limit: resolved.limit,
    source: resolved.source,
    packageId: resolved.packageId,
    packageName: resolved.packageName,
    used: usage.used,
    remaining: Math.max(0, resolved.limit - usage.used),
    resetAtMs: usage.resetAtMs,
  };
}
