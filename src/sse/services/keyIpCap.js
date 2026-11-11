// Active IP cap for the /v1 inference path (plan #5).
//
// A key may be used from at most `maxIps` distinct client IPs inside the
// 10-minute sliding window (distinct IPs, not requests — one IP hammering
// the key counts once). Cap = per-key apiKeys.maxIps, NULL = the global
// default 3 (user decision 2026-11-11). There is NO unlimited value.
//
// Which keys are capped:
//   * Every KNOWN, ACTIVE, UNEXPIRED key is capped.
//   * NO key presented (local mode) → skipped (nothing to count).
//   * UNKNOWN key → skipped here (rejected with 401 elsewhere when
//     requireApiKey is on).
//   * INACTIVE / EXPIRED key → skipped here (rejected with 401 elsewhere).
//
// The check runs once per client request, right after the keyAccess gate
// and BEFORE the RPM check — so a request rejected by the IP cap does not
// consume an RPM slot — and before bypass/combo/credential lookup, so an
// over-cap request never touches a provider account and a combo request
// counts as ONE request (not one per member model).
//
// The client IP comes ONLY from `x-9r-real-ip`, which custom-server.js
// stamps from the TCP socket (spoofed forwarding headers stripped; a
// forwarding header is only trusted when the TCP peer is a local reverse
// proxy). No client-supplied header is ever read. When the header is
// absent (plain `next dev` without custom-server) the check is skipped
// fail-open and the miss is logged — the cap cannot be enforced without
// a trustworthy IP, and guessing from X-Forwarded-For would let a client
// rotate identities at will.
//
// machineId (G10): apiKeys.machineId is the LOCAL machine id (used by the
// CLI-tools/endpoint pages), not a per-key device binding, and it is
// deliberately NOT used here — the IP cap is the single binding
// mechanism for /v1 keys. No second, inconsistent binding is created.
import { getApiKeyById, getApiKeyByKey } from "@/lib/db/repos/apiKeysRepo.js";
import {
  recordIpUsage,
  getActiveIps,
  pruneStaleIpUsageForKey,
  sweepStaleIpUsage,
} from "@/lib/db/repos/keyIpUsageRepo.js";
import { extractClientApiKey } from "@/shared/utils/apiKey.js";
import {
  IP_CAP_WINDOW_MS,
  DEFAULT_MAX_IPS,
  resolveMaxIps,
} from "@/shared/utils/ipCap.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";

// IPv4-mapped IPv6 (::ffff:1.2.3.4) is the same client as 1.2.3.4 —
// normalize so one client cannot count as two IPs. Loopback forms are
// left as-is (they only occur for local requests).
export function normalizeClientIp(raw) {
  const ip = String(raw || "").trim();
  if (ip.startsWith("::ffff:")) return ip.slice("::ffff:".length);
  return ip || null;
}

/** Client IP from the trusted header, or null when it is absent. */
export function extractClientIp(request) {
  const raw = request?.headers?.get?.("x-9r-real-ip");
  return normalizeClientIp(raw);
}

/**
 * Gate for /v1 handlers. Call once per request, after the keyAccess gate
 * and before the RPM check.
 * @returns {Promise<Response|null>} a 429 Response when over the cap, else null.
 */
export async function enforceKeyIpCap(request) {
  const apiKey = extractClientApiKey(request);
  if (!apiKey) return null;
  const record = await getApiKeyByKey(apiKey);
  if (!record || !record.isActive) return null;
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) return null;

  const ip = extractClientIp(request);
  if (!ip) {
    // No trustworthy IP (dev server without custom-server.js) — fail open
    // rather than block every request or guess from a spoofable header.
    log.debug("AUTH", `ip-cap: no x-9r-real-ip header, skipping cap for key "${record.name || record.id}"`);
    return null;
  }

  const cap = resolveMaxIps(record);
  const nowMs = Date.now();
  // Prune stale rows for this key first so the count is the live window.
  await pruneStaleIpUsageForKey(record.id, nowMs).catch(() => 0);
  const activeIps = await getActiveIps(record.id, nowMs);
  const seen = activeIps.some((r) => r.ip === ip);
  if (!seen && activeIps.length >= cap) {
    // New IP over the cap: reject WITHOUT recording it. Admitting it
    // would poison the window — one stray request would lock out the
    // legitimate IPs until the oldest entry expires. An already-seen IP
    // always passes (its timestamp is refreshed below).
    const oldest = activeIps[activeIps.length - 1]; // getActiveIps: newest first
    const retryAfterSec = oldest
      ? Math.max(1, Math.ceil((new Date(oldest.lastSeenAt).getTime() + IP_CAP_WINDOW_MS - nowMs) / 1000))
      : Math.ceil(IP_CAP_WINDOW_MS / 1000);
    log.warn(
      "AUTH",
      `ip-cap: key "${record.name || record.id}" at ${activeIps.length}/${cap} IPs in 10 min (new IP ${ip} rejected)`
    );
    return ipCapExceededResponse({ cap, active: activeIps.length + 1, retryAfterSec });
  }
  await recordIpUsage(record.id, ip, nowMs);
  return null;
}

/** Current IP-cap status of a key (admin keys page / member dashboard). */
export async function getKeyIpStatus(keyId) {
  const record = await getApiKeyById(keyId);
  if (!record) return null;
  const cap = resolveMaxIps(record);
  const nowMs = Date.now();
  const ips = await getActiveIps(record.id, nowMs);
  const oldest = ips.length > 0 ? ips[ips.length - 1] : null;
  return {
    keyId: record.id,
    cap,
    source: record.maxIps != null ? "key" : "default",
    activeCount: ips.length,
    activeIps: ips,
    resetAtMs: oldest
      ? new Date(oldest.lastSeenAt).getTime() + IP_CAP_WINDOW_MS
      : nowMs + IP_CAP_WINDOW_MS,
  };
}

/** 429 response for an over-cap key: Retry-After + standard headers. */
export function ipCapExceededResponse({ cap, active, retryAfterSec }) {
  return errorResponse(
    HTTP_STATUS.RATE_LIMITED,
    `IP cap exceeded: this key allows ${cap} active IPs per 10 minutes (${active} active). Retry after ${retryAfterSec}s.`,
    {
      "Retry-After": String(retryAfterSec),
      "X-IpCap-Limit": String(cap),
      "X-IpCap-Active": String(active),
      "X-IpCap-Reset": String(Math.ceil((Date.now() + retryAfterSec * 1000) / 1000)),
    }
  );
}

// --- Periodic stale-row sweep (started from initializeApp) ---------------

let sweepStarted = false;
let sweepTimer = null;
let sweepTimeout = null;

/**
 * Start the background sweep that deletes key_ip_usage rows older than the
 * window (bounds the table for keys that stop being used — the per-request
 * prune only covers keys that are still active). Safe to call repeatedly.
 * @param {{ intervalMs?: number }} [opts]
 */
export function startIpUsageSweep({ intervalMs } = {}) {
  if (sweepStarted) return false;
  if (typeof process !== "undefined" && process.env?.DISABLE_IP_USAGE_SWEEP) return false;
  sweepStarted = true;
  const period = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 5 * 60 * 1000;
  const tick = () => {
    sweepStaleIpUsage()
      .catch((err) => log.warn("AUTH", "ip-cap: sweep failed (swallowed)", { error: err?.message ?? String(err) }));
  };
  sweepTimeout = setTimeout(tick, 30_000);
  if (sweepTimeout.unref) sweepTimeout.unref();
  sweepTimer = setInterval(tick, period);
  if (sweepTimer.unref) sweepTimer.unref();
  return true;
}

export function stopIpUsageSweep() {
  if (sweepTimeout) { clearTimeout(sweepTimeout); sweepTimeout = null; }
  if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
  sweepStarted = false;
}

// Re-exported for tests / callers that only need the default.
export { DEFAULT_MAX_IPS };
