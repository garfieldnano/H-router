// Egress error taxonomy (plan #1, G1): the rotator must blame the right
// thing — relay (403 abusive traffic), request (400/11128), account (429),
// or nothing. Pure logic, no DB.
import { describe, it, expect } from "vitest";
import {
  classifyEgressError,
  extractUpstreamCode,
  isAbusiveTrafficError,
  isRequestIllegalError,
  pickNextRelayPoolId,
  EGRESS_ACTIONS,
} from "open-sse/services/egressRotator.js";

describe("classifyEgressError", () => {
  it("403 Abusive Traffic → rotate-relay", () => {
    expect(classifyEgressError(403, "Abusive Traffic detected")).toEqual({ action: EGRESS_ACTIONS.ROTATE_RELAY, code: null });
    expect(classifyEgressError(403, "unusual traffic from your network")).toEqual({ action: EGRESS_ACTIONS.ROTATE_RELAY, code: null });
    expect(classifyEgressError(403, "Your IP has been banned for abuse")).toEqual({ action: EGRESS_ACTIONS.ROTATE_RELAY, code: null });
    expect(classifyEgressError(403, "too many requests from this ip")).toEqual({ action: EGRESS_ACTIONS.ROTATE_RELAY, code: null });
  });

  it("403 without abusive wording → other (account fallback decides)", () => {
    expect(classifyEgressError(403, "insufficient quota")).toEqual({ action: EGRESS_ACTIONS.OTHER, code: null });
    expect(classifyEgressError(403, "")).toEqual({ action: EGRESS_ACTIONS.OTHER, code: null });
    expect(classifyEgressError(403, null)).toEqual({ action: EGRESS_ACTIONS.OTHER, code: null });
  });

  it("429 → backoff-account (never rotates the relay)", () => {
    expect(classifyEgressError(429, "rate limit exceeded")).toEqual({ action: EGRESS_ACTIONS.BACKOFF_ACCOUNT, code: null });
  });

  it("400 with code 11128 → request-error (never rotates, never locks)", () => {
    const body = '{"code":11128,"msg":"request illegal"}';
    expect(classifyEgressError(400, body)).toEqual({ action: EGRESS_ACTIONS.REQUEST_ERROR, code: 11128 });
    // "request illegal" text alone is classified as the 11128 case.
    expect(classifyEgressError(400, "request illegal")).toEqual({ action: EGRESS_ACTIONS.REQUEST_ERROR, code: 11128 });
  });

  it("any other 400 → request-error", () => {
    expect(classifyEgressError(400, "context too long")).toEqual({ action: EGRESS_ACTIONS.REQUEST_ERROR, code: null });
  });

  it("401 / 500 / 502 → other", () => {
    expect(classifyEgressError(401, "invalid token").action).toBe(EGRESS_ACTIONS.OTHER);
    expect(classifyEgressError(500, "boom").action).toBe(EGRESS_ACTIONS.OTHER);
    expect(classifyEgressError(502, "bad gateway").action).toBe(EGRESS_ACTIONS.OTHER);
  });
});

describe("extractUpstreamCode", () => {
  it("finds JSON code fields", () => {
    expect(extractUpstreamCode('{"code":11128,"msg":"request illegal"}')).toBe(11128);
    expect(extractUpstreamCode('{"error":{"code":429}}')).toBe(429);
  });
  it("finds code= / code: spellings", () => {
    expect(extractUpstreamCode("code=11128")).toBe(11128);
    expect(extractUpstreamCode("error code: 6004")).toBe(6004);
  });
  it("returns null when no code", () => {
    expect(extractUpstreamCode("plain text error")).toBeNull();
    expect(extractUpstreamCode("")).toBeNull();
    expect(extractUpstreamCode(null)).toBeNull();
  });
});

describe("isAbusiveTrafficError / isRequestIllegalError", () => {
  it("isAbusiveTrafficError is case-insensitive", () => {
    expect(isAbusiveTrafficError("ABUSIVE TRAFFIC")).toBe(true);
    expect(isAbusiveTrafficError("quota exceeded")).toBe(false);
  });
  it("isRequestIllegalError needs status 400", () => {
    expect(isRequestIllegalError(400, '{"code":11128}')).toBe(true);
    expect(isRequestIllegalError(403, '{"code":11128}')).toBe(false);
  });
});

describe("pickNextRelayPoolId", () => {
  const candidates = ["pool-a", "pool-b", "pool-c"];
  it("returns the first candidate not tried and not banned", () => {
    expect(pickNextRelayPoolId(candidates, new Set(), new Set())).toBe("pool-a");
    expect(pickNextRelayPoolId(candidates, new Set(["pool-a"]), new Set())).toBe("pool-b");
    expect(pickNextRelayPoolId(candidates, new Set(), new Set(["pool-a", "pool-b"]))).toBe("pool-c");
  });
  it("returns null when nothing is left", () => {
    expect(pickNextRelayPoolId(candidates, new Set(candidates), new Set())).toBeNull();
    expect(pickNextRelayPoolId([], new Set(), new Set())).toBeNull();
    expect(pickNextRelayPoolId(null, new Set(), new Set())).toBeNull();
  });
});
