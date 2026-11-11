// Live Traffic feed fields (plan G7) — DB-backed, isolated temp DATA_DIR.
// recentRequests must carry the (masked) driving API key + cost, both from
// the live-history path (getUsageStats) and the in-memory ring path
// (getActiveRequests), so the traffic feed can show key / tokens / cost.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-traffic-test-"));
let db;
let usageRepo;
let adapter;

const KEY = "h-router-aaaa1111-aaaaaa-11";
const NOW = new Date().toISOString();

beforeAll(async () => {
  process.env.DATA_DIR = tmpDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  usageRepo = await import("@/lib/db/repos/usageRepo.js");
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  await db.initDb();

  // Seed two usage rows directly (nonzero cost, real API key).
  const run = (ts, model, provider, prompt, completion, cost, status) => {
    adapter.run(
      `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ts, provider, model, null, KEY, "/v1/chat/completions", prompt, completion, cost, status,
        JSON.stringify({ prompt_tokens: prompt, completion_tokens: completion }), JSON.stringify({})]
    );
  };
  run(NOW, "kimi-k3", "kimi", 100, 50, 0.05, "ok");
  run(new Date(Date.now() - 60000).toISOString(), "gpt-5", "codebuddy", 200, 100, 0.02, "ok");
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe("sanitizeUsageStatsForBrowser (G7: full keys must never reach the browser)", () => {
  const FULL_KEY = "h-router-aaaa1111-aaaaaa-11";
  const fakeStats = {
    totalRequests: 3,
    byApiKey: {
      [`${FULL_KEY}|kimi-k3|kimi`]: { requests: 2, promptTokens: 100, completionTokens: 50, cachedTokens: 0, cost: 0.03, rawModel: "kimi-k3", provider: "kimi", apiKeyMasked: "h-router***a-11", apiKeyKey: "h-router***a-11", keyName: "Key A", lastUsed: "2026-11-11T02:00:00.000Z" },
      [`${FULL_KEY}|gpt-5|codebuddy`]: { requests: 1, promptTokens: 200, completionTokens: 100, cachedTokens: 0, cost: 0.02, rawModel: "gpt-5", provider: "codebuddy", apiKeyMasked: "h-router***a-11", apiKeyKey: "h-router***a-11", keyName: "Key A", lastUsed: "2026-11-11T01:00:00.000Z" },
      "local-no-key": { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel: "", provider: "", apiKeyMasked: null, apiKeyKey: "local-no-key", keyName: "Local (No API Key)", lastUsed: null },
    },
    recentRequests: [{ model: "kimi-k3", apiKey: "h-router***a-11", cost: 0.03 }],
  };

  it("re-keys byApiKey by the masked composite; no full key anywhere in the payload", () => {
    const out = usageRepo.sanitizeUsageStatsForBrowser(fakeStats);
    expect(JSON.stringify(out)).not.toContain(FULL_KEY);
    expect(JSON.stringify(out)).not.toContain("aaaa1111");
    expect(Object.keys(out.byApiKey).sort()).toEqual([
      "h-router***a-11|gpt-5|codebuddy",
      "h-router***a-11|kimi-k3|kimi",
      "local-no-key",
    ]);
    expect(out.byApiKey["h-router***a-11|kimi-k3|kimi"].requests).toBe(2);
    expect(out.byApiKey["h-router***a-11|kimi-k3|kimi"].keyName).toBe("Key A");
    expect(out.totalRequests).toBe(3);
    expect(out.recentRequests).toEqual(fakeStats.recentRequests);
  });

  it("does not mutate the input stats object", () => {
    const before = JSON.stringify(fakeStats);
    usageRepo.sanitizeUsageStatsForBrowser(fakeStats);
    expect(JSON.stringify(fakeStats)).toBe(before);
    expect(Object.keys(fakeStats.byApiKey)[0]).toContain("aaaa1111");
  });

  it("merges entries that collide on the masked composite instead of dropping one", () => {
    const colliding = {
      byApiKey: {
        "h-router-11111111-aaaaaa-11|m|p": { requests: 1, promptTokens: 10, completionTokens: 5, cachedTokens: 0, cost: 0.01, rawModel: "m", provider: "p", apiKeyMasked: "h-router***a-11", apiKeyKey: "h-router***a-11", keyName: "Key 1", lastUsed: "2026-11-11T01:00:00.000Z" },
        "h-router-22222222-bbbbbb-11|m|p": { requests: 2, promptTokens: 20, completionTokens: 10, cachedTokens: 0, cost: 0.02, rawModel: "m", provider: "p", apiKeyMasked: "h-router***a-11", apiKeyKey: "h-router***a-11", keyName: "Key 2", lastUsed: "2026-11-11T02:00:00.000Z" },
      },
    };
    const out = usageRepo.sanitizeUsageStatsForBrowser(colliding);
    expect(Object.keys(out.byApiKey)).toHaveLength(1);
    expect(out.byApiKey["h-router***a-11|m|p"].requests).toBe(3);
    expect(out.byApiKey["h-router***a-11|m|p"].cost).toBeCloseTo(0.03);
    expect(out.byApiKey["h-router***a-11|m|p"].lastUsed).toBe("2026-11-11T02:00:00.000Z");
  });

  it("passes through stats without byApiKey", () => {
    expect(usageRepo.sanitizeUsageStatsForBrowser(null)).toBeNull();
    expect(usageRepo.sanitizeUsageStatsForBrowser({ totalRequests: 0 })).toEqual({ totalRequests: 0 });
  });
});
describe("recentRequests carries masked key + cost (Live Traffic feed)", () => {
  it("getUsageStats('today') recentRequests has apiKey (masked) + cost", async () => {
    const stats = await usageRepo.getUsageStats("today");
    expect(stats.totalRequests).toBe(2);
    const kimi = stats.recentRequests.find((r) => r.model === "kimi-k3");
    expect(kimi).toBeDefined();
    // Masked: first 8 chars + *** + last 4 — never the full key.
    expect(kimi.apiKey).toBe("h-router***a-11");
    expect(kimi.apiKey).not.toContain("aaaa1111");
    expect(kimi.cost).toBeCloseTo(0.05);
    expect(kimi.promptTokens).toBe(100);
    expect(kimi.completionTokens).toBe(50);
    expect(kimi.status).toBe("ok");
  });

  it("getActiveRequests() ring recentRequests has the same fields", async () => {
    const { recentRequests } = await usageRepo.getActiveRequests();
    const kimi = recentRequests.find((r) => r.model === "kimi-k3");
    expect(kimi).toBeDefined();
    expect(kimi.apiKey).toBe("h-router***a-11");
    expect(kimi.cost).toBeCloseTo(0.05);
  });
});
