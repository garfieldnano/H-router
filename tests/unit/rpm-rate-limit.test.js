// RPM limiter — pure sliding-window counter + validation + 429 response.
// No DB, no network: the window is exercised with an explicit clock.
import { describe, it, expect, beforeEach } from "vitest";
import {
  checkRateLimit, getRateUsage, resetRateLimits, sweepStaleBuckets,
  rateLimitExceededResponse, RPM_WINDOW_MS,
} from "../../src/sse/services/rateLimit.js";
import {
  parseRpmLimit, RPM_MIN, RPM_MAX, TRIAL_DEFAULT_RPM, GLOBAL_DEFAULT_RPM,
} from "../../src/shared/utils/rpmLimit.js";

beforeEach(() => {
  resetRateLimits();
});

describe("sliding window", () => {
  it("allows up to the limit, then denies within the same minute", () => {
    const t0 = 1_000_000;
    const r1 = checkRateLimit("k1", 2, t0);
    expect(r1.allowed).toBe(true);
    expect(r1.used).toBe(1);
    expect(r1.remaining).toBe(1);
    const r2 = checkRateLimit("k1", 2, t0 + 1000);
    expect(r2.allowed).toBe(true);
    expect(r2.used).toBe(2);
    expect(r2.remaining).toBe(0);
    const r3 = checkRateLimit("k1", 2, t0 + 2000);
    expect(r3.allowed).toBe(false);
    expect(r3.used).toBe(2);
    // Oldest request was at t0 → retry after (t0 + 60s - now) = 58s.
    expect(r3.retryAfterSec).toBe(58);
    expect(r3.resetAtMs).toBe(t0 + RPM_WINDOW_MS);
  });

  it("slides: requests older than 60s fall out of the window", () => {
    const t0 = 1_000_000;
    checkRateLimit("k1", 2, t0);
    checkRateLimit("k1", 2, t0 + 1000);
    expect(checkRateLimit("k1", 2, t0 + 2000).allowed).toBe(false);
    // t0 + 60s: the first request expires → allowed again.
    const after = checkRateLimit("k1", 2, t0 + 60_000);
    expect(after.allowed).toBe(true);
    expect(after.used).toBe(2); // second request + this one
    // t0 + 61s: only this request remains in the window.
    expect(checkRateLimit("k1", 2, t0 + 61_000).used).toBe(2);
  });

  it("counts per key — two keys do not share a bucket", () => {
    const t0 = 1_000_000;
    checkRateLimit("key-a", 1, t0);
    expect(checkRateLimit("key-a", 1, t0 + 100).allowed).toBe(false);
    expect(checkRateLimit("key-b", 1, t0 + 100).allowed).toBe(true);
    expect(checkRateLimit("key-b", 1, t0 + 200).allowed).toBe(false);
  });

  it("getRateUsage reads without recording", () => {
    const t0 = 1_000_000;
    expect(getRateUsage("k9", t0).used).toBe(0);
    checkRateLimit("k9", 5, t0);
    checkRateLimit("k9", 5, t0 + 500);
    expect(getRateUsage("k9", t0 + 1000).used).toBe(2);
    expect(getRateUsage("k9", t0 + 1000).used).toBe(2); // still 2 — no recording
  });

  it("sweepStaleBuckets drops fully-stale buckets", () => {
    checkRateLimit("old", 5, 1_000_000);
    checkRateLimit("new", 5, 1_000_000 + 59_000);
    expect(sweepStaleBuckets(1_000_000 + 61_000)).toBe(1);
    expect(getRateUsage("old", 1_000_000 + 61_000).used).toBe(0);
    expect(getRateUsage("new", 1_000_000 + 61_000).used).toBe(1);
  });

  it("resetRateLimits clears every counter", () => {
    checkRateLimit("k1", 1, 1_000_000);
    expect(checkRateLimit("k1", 1, 1_000_001).allowed).toBe(false);
    resetRateLimits();
    expect(checkRateLimit("k1", 1, 1_000_002).allowed).toBe(true);
  });
});

describe("429 response", () => {
  it("returns 429 with Retry-After + X-RateLimit headers", async () => {
    const res = rateLimitExceededResponse({ limit: 20, used: 20, retryAfterSec: 37 });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("37");
    expect(res.headers.get("X-RateLimit-Limit")).toBe("20");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(res.headers.get("X-RateLimit-Reset")).toMatch(/^\d+$/);
    const body = await res.json();
    expect(body.error.message).toMatch(/20 requests per minute/);
    expect(body.error.message).toMatch(/37s/);
  });
});

describe("parseRpmLimit", () => {
  it("accepts integers in range, incl. numeric strings", () => {
    expect(parseRpmLimit(20)).toEqual({ ok: true, value: 20 });
    expect(parseRpmLimit("30")).toEqual({ ok: true, value: 30 });
    expect(parseRpmLimit(RPM_MIN)).toEqual({ ok: true, value: RPM_MIN });
    expect(parseRpmLimit(RPM_MAX)).toEqual({ ok: true, value: RPM_MAX });
  });

  it("null/undefined/empty means inherit", () => {
    expect(parseRpmLimit(null)).toEqual({ ok: true, value: null });
    expect(parseRpmLimit(undefined)).toEqual({ ok: true, value: null });
    expect(parseRpmLimit("")).toEqual({ ok: true, value: null });
  });

  it("rejects 0, negatives, fractions, non-numbers, above max", () => {
    for (const bad of [0, -1, 1.5, "abc", RPM_MAX + 1, NaN]) {
      expect(parseRpmLimit(bad).ok).toBe(false);
    }
  });
});

describe("RPM constants", () => {
  it("trial default 20, global default 50, no unlimited tier", () => {
    expect(TRIAL_DEFAULT_RPM).toBe(20);
    expect(GLOBAL_DEFAULT_RPM).toBe(50);
    expect(RPM_MIN).toBe(1);
  });
});
