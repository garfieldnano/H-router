// Health scanner — classification + parallel run + bulk delete.
// DB-backed, isolated temp DATA_DIR. The probe itself (testSingleConnection)
// is NOT exercised here (it hits real provider APIs); the tester is injected.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-scanner-test-"));
let db;
let scanner;

beforeAll(async () => {
  process.env.DATA_DIR = tmpDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  scanner = await import("@/lib/keys/healthScanner.js");
  await db.initDb();
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

async function makeConn(provider, name) {
  return db.createProviderConnection({
    provider,
    authType: "apikey",
    name,
    apiKey: "fake-key-for-test",
  });
}

describe("classifyScanResult", () => {
  it("valid → healthy", () => {
    expect(scanner.classifyScanResult({ valid: true })).toBe("healthy");
  });
  it("rate-limit signals → limit", () => {
    for (const error of [
      "API returned 429",
      "Rate limit exceeded",
      "quota exhausted",
      "Too many requests",
    ]) {
      expect(scanner.classifyScanResult({ valid: false, error })).toBe("limit");
    }
  });
  it("credential rejections → dead", () => {
    for (const error of [
      "Invalid API key",
      "Invalid API key or base URL",
      "Token invalid or revoked",
      "Access denied",
      "Token expired",
      "Token expired and refresh failed",
      "No access token",
      "Unauthorized",
    ]) {
      expect(scanner.classifyScanResult({ valid: false, error })).toBe("dead");
    }
  });
  it("inconclusive signals → unknown (never claim dead without evidence)", () => {
    for (const error of [
      "Provider test not supported",
      "Missing base URL",
      "fetch failed",
      "API returned 500",
      "The operation timed out",
      "socket hang up",
      "",
      undefined,
    ]) {
      expect(scanner.classifyScanResult({ valid: false, error })).toBe("unknown");
    }
    expect(scanner.classifyScanResult(null)).toBe("unknown");
    expect(scanner.classifyScanResult({})).toBe("unknown");
  });
});

describe("runHealthScan with a mock tester", () => {
  it("classifies, persists health fields, and summarizes", async () => {
    const a = await makeConn("openai", "Scan A");
    const b = await makeConn("openai", "Scan B");
    const c = await makeConn("deepseek", "Scan C");
    const d = await makeConn("groq", "Scan D");
    const byId = {
      [a.id]: { valid: true, latencyMs: 120 },
      [b.id]: { valid: false, error: "Invalid API key", latencyMs: 90 },
      [c.id]: { valid: false, error: "API returned 429", latencyMs: 200 },
      [d.id]: { valid: false, error: "fetch failed", latencyMs: 5000 },
    };
    const state = await scanner.runHealthScan({
      tester: async (id) => byId[id],
    });
    expect(state.running).toBe(false);
    expect(state.total).toBe(4);
    expect(state.done).toBe(4);
    expect(state.summary).toMatchObject({ total: 4, healthy: 1, limit: 1, dead: 1, unknown: 1 });
    const ra = await db.getProviderConnectionById(a.id);
    expect(ra).toMatchObject({ healthStatus: "healthy", healthError: null, healthLatencyMs: 120 });
    expect(ra.healthCheckedAt).toBeTruthy();
    const rb = await db.getProviderConnectionById(b.id);
    expect(rb).toMatchObject({ healthStatus: "dead", healthError: "Invalid API key" });
    const rc = await db.getProviderConnectionById(c.id);
    expect(rc.healthStatus).toBe("limit");
    const rd = await db.getProviderConnectionById(d.id);
    expect(rd.healthStatus).toBe("unknown");
    // Inactive connections are not scanned.
    const inactive = await makeConn("openai", "Scan inactive");
    await db.updateProviderConnection(inactive.id, { isActive: false });
    const state2 = await scanner.runHealthScan({ tester: async () => ({ valid: true }) });
    expect(state2.total).toBe(4);
    const ri = await db.getProviderConnectionById(inactive.id);
    expect(ri.healthStatus).toBeUndefined();
  });

  it("respects the global and per-provider concurrency caps", async () => {
    const conns = [];
    for (let i = 0; i < 6; i++) conns.push(await makeConn("openai", `Conc ${i}`));
    for (let i = 0; i < 3; i++) conns.push(await makeConn("deepseek", `ConcD ${i}`));
    let inFlight = 0;
    let maxInFlight = 0;
    const perProvider = new Map();
    let maxPerProvider = 0;
    // The scan covers every active connection in the shared test DB, not
    // just the ones this test created — map every id to its real provider
    // so the per-provider measurement is honest (a fallback bucket would
    // collapse distinct providers into one fake "provider").
    const allConns = await db.getProviderConnections();
    const providerById = new Map(allConns.map((c) => [c.id, c.provider]));
    const tester = async (id) => {
      const provider = providerById.get(id) || "other";
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      perProvider.set(provider, (perProvider.get(provider) || 0) + 1);
      maxPerProvider = Math.max(maxPerProvider, perProvider.get(provider));
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      perProvider.set(provider, perProvider.get(provider) - 1);
      return { valid: true, latencyMs: 20 };
    };
    await scanner.runHealthScan({ tester, concurrency: 2, perProviderConcurrency: 1 });
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(maxPerProvider).toBeLessThanOrEqual(1);
  });

  it("a second run while one is in flight → SCAN_RUNNING", async () => {
    await makeConn("openai", "Slow");
    let release;
    const gate = new Promise((r) => { release = r; });
    const slow = async () => { await gate; return { valid: true }; };
    const first = scanner.runHealthScan({ tester: slow });
    await expect(scanner.runHealthScan({ tester: slow })).rejects.toMatchObject({ code: "SCAN_RUNNING" });
    release();
    await first;
    expect(scanner.getScanState().running).toBe(false);
  });

  it("a throwing tester marks the connection unknown, not dead", async () => {
    const conn = await makeConn("openai", "Thrower");
    await scanner.runHealthScan({
      tester: async (id) => {
        if (id === conn.id) throw new Error("boom");
        return { valid: true };
      },
    });
    const row = await db.getProviderConnectionById(conn.id);
    expect(row.healthStatus).toBe("unknown");
    expect(row.healthError).toBe("boom");
  });
});

describe("deleteDeadConnections", () => {
  it("deletes only stored-dead connections", async () => {
    const dead = await makeConn("openai", "To delete");
    const alive = await makeConn("openai", "To keep");
    const limited = await makeConn("deepseek", "Limited keep");
    const unknown = await makeConn("groq", "Unknown keep");
    await db.updateProviderConnection(dead.id, { healthStatus: "dead" });
    await db.updateProviderConnection(alive.id, { healthStatus: "healthy" });
    await db.updateProviderConnection(limited.id, { healthStatus: "limit" });
    await db.updateProviderConnection(unknown.id, { healthStatus: "unknown" });
    const res = await scanner.deleteDeadConnections([
      dead.id, alive.id, limited.id, unknown.id, "missing-id",
    ]);
    expect(res.deleted).toEqual([dead.id]);
    expect(res.skipped).toEqual(expect.arrayContaining([alive.id, limited.id, unknown.id, "missing-id"]));
    expect(await db.getProviderConnectionById(dead.id)).toBeNull();
    expect(await db.getProviderConnectionById(alive.id)).not.toBeNull();
  });
});
