// Pure-logic tests for downtime compensation (§0d): tier mapping,
// expiry extension, error-rate evaluation, incident duration.
// No DB, no Telegram — imports the canonical .mjs module directly.
import { describe, it, expect } from "vitest";
import {
  tierForOutageMinutes,
  isValidTierHours,
  extendExpiry,
  evaluateErrorRate,
  incidentDurationMinutes,
  COMPENSATION_TIER_HOURS,
  ERROR_RATE_THRESHOLD,
  ERROR_RATE_MIN_REQUESTS,
  renderIncident,
  renderCompensationHistory,
} from "../../src/lib/bot/compensation.mjs";

describe("tierForOutageMinutes", () => {
  it("outage < 1h → +1h", () => {
    expect(tierForOutageMinutes(0)).toBe(1);
    expect(tierForOutageMinutes(1)).toBe(1);
    expect(tierForOutageMinutes(59)).toBe(1);
  });
  it("outage 1–3h → +3h (boundaries belong to this band)", () => {
    expect(tierForOutageMinutes(60)).toBe(3);
    expect(tierForOutageMinutes(61)).toBe(3);
    expect(tierForOutageMinutes(179)).toBe(3);
    expect(tierForOutageMinutes(180)).toBe(3);
  });
  it("outage 3–5h → +5h", () => {
    expect(tierForOutageMinutes(181)).toBe(5);
    expect(tierForOutageMinutes(299)).toBe(5);
    expect(tierForOutageMinutes(300)).toBe(5);
  });
  it("outage > 5h → +8h", () => {
    expect(tierForOutageMinutes(301)).toBe(8);
    expect(tierForOutageMinutes(600)).toBe(8);
    expect(tierForOutageMinutes(100000)).toBe(8);
  });
  it("negative / NaN durations fall back to the lowest tier", () => {
    expect(tierForOutageMinutes(-5)).toBe(1);
    expect(tierForOutageMinutes(NaN)).toBe(1);
    expect(tierForOutageMinutes(undefined)).toBe(1);
  });
  it("tier hours are exactly 1/3/5/8", () => {
    expect(COMPENSATION_TIER_HOURS).toEqual([1, 3, 5, 8]);
    for (const h of [1, 3, 5, 8]) expect(isValidTierHours(h)).toBe(true);
    for (const h of [0, 2, 4, 6, 7, 9, null]) expect(isValidTierHours(h)).toBe(false);
  });
});

describe("extendExpiry", () => {
  it("adds exactly N hours to a future expiry", () => {
    const now = new Date("2026-11-11T00:00:00.000Z");
    const out = extendExpiry("2026-11-12T00:00:00.000Z", 3, now);
    expect(out).toBe("2026-11-12T03:00:00.000Z");
  });
  it("extends from NOW when the key already expired", () => {
    const now = new Date("2026-11-11T00:00:00.000Z");
    const out = extendExpiry("2026-11-10T00:00:00.000Z", 5, now);
    expect(out).toBe("2026-11-11T05:00:00.000Z");
  });
  it("adds 8h for the top tier", () => {
    const now = new Date("2026-11-11T00:00:00.000Z");
    expect(extendExpiry("2026-11-11T00:00:00.000Z", 8, now)).toBe("2026-11-11T08:00:00.000Z");
  });
});

describe("incidentDurationMinutes", () => {
  it("closed incident: endedAt - startedAt, rounded", () => {
    expect(incidentDurationMinutes({
      startedAt: "2026-11-11T00:00:00.000Z",
      endedAt: "2026-11-11T02:30:00.000Z",
    })).toBe(150);
  });
  it("open incident: startedAt to now", () => {
    expect(incidentDurationMinutes(
      { startedAt: "2026-11-11T00:00:00.000Z", endedAt: null },
      new Date("2026-11-11T01:00:00.000Z")
    )).toBe(60);
  });
  it("never negative, 0 for garbage", () => {
    expect(incidentDurationMinutes({ startedAt: "2026-11-11T02:00:00.000Z", endedAt: "2026-11-11T01:00:00.000Z" })).toBe(0);
    expect(incidentDurationMinutes({})).toBe(0);
    expect(incidentDurationMinutes(null)).toBe(0);
  });
});

describe("evaluateErrorRate", () => {
  it("high error rate with enough requests = down", () => {
    expect(evaluateErrorRate({ total: 20, errors: 15 }).isDown).toBe(true);
    expect(evaluateErrorRate({ total: 20, errors: 11 }).isDown).toBe(true);
  });
  it("exactly at the threshold is NOT down (strictly above)", () => {
    expect(evaluateErrorRate({ total: 20, errors: 10 }).isDown).toBe(false);
    expect(evaluateErrorRate({ total: 20, errors: 9 }).isDown).toBe(false);
  });
  it("too few requests = inconclusive, never down", () => {
    expect(evaluateErrorRate({ total: ERROR_RATE_MIN_REQUESTS - 1, errors: ERROR_RATE_MIN_REQUESTS - 1 }).isDown).toBe(false);
    expect(evaluateErrorRate({ total: 0, errors: 0 }).isDown).toBe(false);
  });
  it("reports the rate", () => {
    const r = evaluateErrorRate({ total: 40, errors: 10 });
    expect(r.rate).toBe(0.25);
    expect(r.total).toBe(40);
    expect(r.errors).toBe(10);
  });
  it("threshold constant is 0.5", () => {
    expect(ERROR_RATE_THRESHOLD).toBe(0.5);
  });
});

describe("rendering", () => {
  it("renderIncident shows duration + derived tier", () => {
    const text = renderIncident({
      id: "abc12345-0000-0000-0000-000000000000",
      scope: "gateway",
      reason: "unreachable",
      status: "closed",
      startedAt: "2026-11-11T00:00:00.000Z",
      endedAt: "2026-11-11T02:00:00.000Z",
      durationMinutes: 120,
    });
    expect(text).toContain("120 menit");
    expect(text).toContain("+3 jam");
    expect(text).toContain("Selesai");
  });
  it("renderCompensationHistory lists grants, empty state otherwise", () => {
    expect(renderCompensationHistory([])).toContain("Belum ada kompensasi");
    const text = renderCompensationHistory([{
      amount: 3,
      incidentId: "abc12345-0000-0000-0000-000000000000",
      grantedAt: "2026-11-11T03:00:00.000Z",
      newExpiresAt: "2026-11-12T03:00:00.000Z",
    }]);
    expect(text).toContain("+3 jam");
  });
});
