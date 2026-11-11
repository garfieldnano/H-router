// RPM (requests per minute) limiter — pure sliding-window counter.
//
// In-memory only: a server restart resets every counter (accepted
// limitation, plan §0c; a persistent counter would need a key_rate_usage
// table). Counters are per KEY (not per member): a member with several keys
// gets the limit on each key separately. One process = one counter set; if
// the gateway ever runs multiple processes, each counts independently.
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";

export const RPM_WINDOW_MS = 60_000;

// keyId -> ascending array of request timestamps (ms). Bounded by the key's
// own limit (at most `limit` entries survive pruning), plus lazy cleanup of
// fully-stale buckets below.
const buckets = new Map();

function prune(stamps, nowMs) {
  let cut = 0;
  while (cut < stamps.length && stamps[cut] <= nowMs - RPM_WINDOW_MS) cut++;
  if (cut > 0) stamps.splice(0, cut);
  return stamps;
}

/**
 * Record one request for a key against its limit.
 * @returns {{ allowed: boolean, used: number, remaining: number, limit: number, resetAtMs: number, retryAfterSec: number }}
 */
export function checkRateLimit(keyId, limit, nowMs = Date.now()) {
  let stamps = buckets.get(keyId);
  if (!stamps) {
    stamps = [];
    buckets.set(keyId, stamps);
  }
  prune(stamps, nowMs);
  if (stamps.length >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((stamps[0] + RPM_WINDOW_MS - nowMs) / 1000));
    return {
      allowed: false,
      used: stamps.length,
      remaining: 0,
      limit,
      resetAtMs: stamps[0] + RPM_WINDOW_MS,
      retryAfterSec,
    };
  }
  stamps.push(nowMs);
  return {
    allowed: true,
    used: stamps.length,
    remaining: limit - stamps.length,
    limit,
    resetAtMs: nowMs + RPM_WINDOW_MS,
    retryAfterSec: 0,
  };
}

/** Current-minute usage for a key WITHOUT recording a request. */
export function getRateUsage(keyId, nowMs = Date.now()) {
  const stamps = buckets.get(keyId);
  if (!stamps || stamps.length === 0) return { used: 0, resetAtMs: nowMs + RPM_WINDOW_MS };
  prune(stamps, nowMs);
  if (stamps.length === 0) {
    buckets.delete(keyId);
    return { used: 0, resetAtMs: nowMs + RPM_WINDOW_MS };
  }
  return { used: stamps.length, resetAtMs: stamps[0] + RPM_WINDOW_MS };
}

/** Drop fully-stale buckets (called lazily to bound memory). */
export function sweepStaleBuckets(nowMs = Date.now()) {
  for (const [keyId, stamps] of buckets) {
    prune(stamps, nowMs);
    if (stamps.length === 0) buckets.delete(keyId);
  }
  return buckets.size;
}

/** Test helper — clears every counter. */
export function resetRateLimits() {
  buckets.clear();
}

/** 429 response for a rate-limited key: Retry-After + standard headers. */
export function rateLimitExceededResponse({ limit, used, retryAfterSec }) {
  return errorResponse(
    HTTP_STATUS.RATE_LIMITED,
    `Rate limit exceeded: this key allows ${limit} requests per minute (${used} used). Retry after ${retryAfterSec}s.`,
    {
      "Retry-After": String(retryAfterSec),
      "X-RateLimit-Limit": String(limit),
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Reset": String(Math.ceil((Date.now() + retryAfterSec * 1000) / 1000)),
    }
  );
}
