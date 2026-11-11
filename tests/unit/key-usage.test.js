// Per-key usage aggregation (plan G7) — pure-logic tests, no DB.
// byApiKey map keys are the MASKED composite (AUDIT-002); entries carry
// keyId for the join to key/member metadata.
import { describe, it, expect } from "vitest";
import { aggregateUsageByKey } from "../../src/shared/utils/keyUsage.js";

const MASKED_A = "h-router***a-11";
const MASKED_B = "h-router***b-22";

function statsWith(entries) {
  return { byApiKey: Object.fromEntries(entries) };
}

describe("aggregateUsageByKey", () => {
  it("groups model/provider entries back per key and sums them", () => {
    const stats = statsWith([
      [`${MASKED_A}|kimi-k3|kimi`, { requests: 3, promptTokens: 100, completionTokens: 50, cost: 0.03, rawModel: "kimi-k3", provider: "kimi", apiKeyMasked: MASKED_A, apiKeyKey: MASKED_A, keyName: "Key A", keyId: "k-a", lastUsed: "2026-11-11T01:00:00.000Z" }],
      [`${MASKED_A}|gpt-5|codebuddy`, { requests: 2, promptTokens: 200, completionTokens: 100, cost: 0.02, rawModel: "gpt-5", provider: "codebuddy", apiKeyMasked: MASKED_A, apiKeyKey: MASKED_A, keyName: "Key A", keyId: "k-a", lastUsed: "2026-11-11T02:00:00.000Z" }],
      [`${MASKED_B}|kimi-k3|kimi`, { requests: 1, promptTokens: 10, completionTokens: 5, cost: 0.001, rawModel: "kimi-k3", provider: "kimi", apiKeyMasked: MASKED_B, apiKeyKey: MASKED_B, keyName: "Key B", keyId: "k-b", lastUsed: "2026-11-11T01:30:00.000Z" }],
    ]);
    const rows = aggregateUsageByKey(stats, [
      { id: "k-a", key: "h-router-aaaa1111-aaaaaa-11", name: "Key A", memberId: "m-1", isActive: true, rpmLimit: 20, maxIps: 3 },
      { id: "k-b", key: "h-router-bbbb2222-bbbbbb-22", name: "Key B", memberId: null, isActive: true, rpmLimit: null, maxIps: null },
    ], [{ id: "m-1", name: "Budi" }]);

    expect(rows).toHaveLength(2);
    const [a, b] = rows; // sorted by requests desc
    expect(a.keyId).toBe("k-a");
    expect(a.requests).toBe(5);
    expect(a.promptTokens).toBe(300);
    expect(a.completionTokens).toBe(150);
    expect(a.cost).toBeCloseTo(0.05);
    expect(a.memberName).toBe("Budi");
    expect(a.rpmLimit).toBe(20);
    expect(a.maxIps).toBe(3);
    expect(a.lastUsed).toBe("2026-11-11T02:00:00.000Z");
    expect(a.models).toEqual([
      { model: "kimi-k3", provider: "kimi", requests: 3 },
      { model: "gpt-5", provider: "codebuddy", requests: 2 },
    ]);
    expect(b.requests).toBe(1);
    expect(b.memberName).toBeNull();
  });

  it("includes keys with zero usage in the period", () => {
    const rows = aggregateUsageByKey(statsWith([]), [
      { id: "k-a", key: "h-router-aaaa1111-aaaaaa-11", name: "Key A", memberId: null, isActive: true },
    ], []);
    expect(rows).toHaveLength(1);
    expect(rows[0].requests).toBe(0);
    expect(rows[0].models).toEqual([]);
    expect(rows[0].keyName).toBe("Key A");
  });

  it("groups usage of a deleted key (no keyId) by its masked key", () => {
    const stats = statsWith([
      [`${MASKED_A}|m|p`, { requests: 4, promptTokens: 40, completionTokens: 20, cost: 0.04, rawModel: "m", provider: "p", apiKeyMasked: MASKED_A, apiKeyKey: MASKED_A, keyName: "Deleted key", keyId: null, lastUsed: "2026-11-11T01:00:00.000Z" }],
    ]);
    const rows = aggregateUsageByKey(stats, [], []);
    expect(rows).toHaveLength(1);
    expect(rows[0].keyId).toBeNull();
    expect(rows[0].requests).toBe(4);
    expect(rows[0].maskedKey).toBe(MASKED_A);
    expect(rows[0].keyName).toBe("Deleted key");
  });

  it("puts the local-no-key bucket last even when it has the most requests", () => {
    const stats = statsWith([
      ["local-no-key", { requests: 99, promptTokens: 1, completionTokens: 1, cost: 0, rawModel: "m", provider: "p", apiKeyMasked: null, apiKeyKey: "local-no-key", keyName: "Local (No API Key)", keyId: null, lastUsed: "2026-11-11T03:00:00.000Z" }],
      [`${MASKED_A}|m|p`, { requests: 1, promptTokens: 1, completionTokens: 1, cost: 0, rawModel: "m", provider: "p", apiKeyMasked: MASKED_A, apiKeyKey: MASKED_A, keyName: "Key A", keyId: "k-a", lastUsed: "2026-11-11T01:00:00.000Z" }],
    ]);
    const rows = aggregateUsageByKey(stats, [{ id: "k-a", key: "h-router-aaaa1111-aaaaaa-11", name: "Key A", isActive: true }], []);
    expect(rows[0].keyId).toBe("k-a");
    expect(rows[1].isLocalNoKey).toBe(true);
    expect(rows[1].requests).toBe(99);
  });

  it("returns [] for empty stats and no keys", () => {
    expect(aggregateUsageByKey({}, [], [])).toEqual([]);
    expect(aggregateUsageByKey(null, [], [])).toEqual([]);
  });
});
