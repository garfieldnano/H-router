// Active IP cap — DB-backed, isolated temp DATA_DIR.
// Default cap 3 (user decision 2026-11-11), window 10 minutes, per-key
// apiKeys.maxIps override. 429 when a 4th distinct IP appears in-window.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-ipcap-test-"));
let db;
let ipCap;
let ipRepo;
let parse;

const WINDOW_MS = 10 * 60 * 1000;

beforeAll(async () => {
  process.env.DATA_DIR = tmpDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  ipCap = await import("@/sse/services/keyIpCap.js");
  ipRepo = await import("@/lib/db/repos/keyIpUsageRepo.js");
  parse = await import("@/shared/utils/ipCap.js");
  await db.initDb();
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

function mockRequest(apiKey, ip) {
  return {
    url: "http://localhost:20128/v1/chat/completions",
    headers: {
      get: (name) => {
        const n = name.toLowerCase();
        if (n === "authorization" && apiKey) return `Bearer ${apiKey}`;
        if (n === "x-9r-real-ip" && ip) return ip;
        return null;
      },
    },
  };
}

async function makeKey(name = "IP cap key") {
  return db.createApiKey(name, "test-machine");
}

describe("parseMaxIps", () => {
  it("null/undefined/empty → null (use default)", () => {
    expect(parse.parseMaxIps(null)).toEqual({ ok: true, value: null });
    expect(parse.parseMaxIps(undefined)).toEqual({ ok: true, value: null });
    expect(parse.parseMaxIps("")).toEqual({ ok: true, value: null });
  });
  it("accepts integers 1–100", () => {
    expect(parse.parseMaxIps(1)).toEqual({ ok: true, value: 1 });
    expect(parse.parseMaxIps("5")).toEqual({ ok: true, value: 5 });
    expect(parse.parseMaxIps(100)).toEqual({ ok: true, value: 100 });
  });
  it("rejects 0, >100, fractions, non-numbers", () => {
    for (const bad of [0, 101, 1.5, "abc", "3.5", NaN]) {
      expect(parse.parseMaxIps(bad).ok).toBe(false);
    }
  });
});

describe("resolveMaxIps", () => {
  it("NULL → default 3; override wins", () => {
    expect(parse.resolveMaxIps({ maxIps: null })).toBe(3);
    expect(parse.resolveMaxIps({})).toBe(3);
    expect(parse.resolveMaxIps({ maxIps: 1 })).toBe(1);
  });
});

describe("normalizeClientIp / extractClientIp", () => {
  it("strips ::ffff: IPv4-mapped prefix", () => {
    expect(ipCap.normalizeClientIp("::ffff:1.2.3.4")).toBe("1.2.3.4");
    expect(ipCap.normalizeClientIp("2001:db8::1")).toBe("2001:db8::1");
    expect(ipCap.normalizeClientIp("")).toBeNull();
  });
  it("reads x-9r-real-ip only; missing header → null", () => {
    expect(ipCap.extractClientIp(mockRequest("k", "10.0.0.1"))).toBe("10.0.0.1");
    expect(ipCap.extractClientIp(mockRequest("k", null))).toBeNull();
    // A spoofable header must never be read: X-Forwarded-For is ignored.
    const spoof = {
      url: "http://localhost/v1/chat/completions",
      headers: { get: (n) => (n.toLowerCase() === "x-forwarded-for" ? "9.9.9.9" : null) },
    };
    expect(ipCap.extractClientIp(spoof)).toBeNull();
  });
});

describe("enforceKeyIpCap", () => {
  it("no key / unknown key / inactive key / expired key → skipped (null)", async () => {
    expect(await ipCap.enforceKeyIpCap(mockRequest(null, "1.1.1.1"))).toBeNull();
    expect(await ipCap.enforceKeyIpCap(mockRequest("h-router-nope", "1.1.1.1"))).toBeNull();
    const dead = await makeKey("inactive");
    await db.updateApiKey(dead.id, { isActive: false });
    expect(await ipCap.enforceKeyIpCap(mockRequest(dead.key, "1.1.1.1"))).toBeNull();
    const exp = await makeKey("expired");
    await db.updateApiKey(exp.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(await ipCap.enforceKeyIpCap(mockRequest(exp.key, "1.1.1.1"))).toBeNull();
  });

  it("missing x-9r-real-ip header → fail-open (null)", async () => {
    const key = await makeKey("no-header");
    expect(await ipCap.enforceKeyIpCap(mockRequest(key.key, null))).toBeNull();
    expect(await ipRepo.countActiveIps(key.id)).toBe(0);
  });

  it("3 distinct IPs pass, the 4th → 429 with Retry-After + X-IpCap headers", async () => {
    const key = await makeKey("cap-3");
    for (const ip of ["10.0.0.1", "10.0.0.2", "10.0.0.3"]) {
      expect(await ipCap.enforceKeyIpCap(mockRequest(key.key, ip))).toBeNull();
    }
    const denied = await ipCap.enforceKeyIpCap(mockRequest(key.key, "10.0.0.4"));
    expect(denied).not.toBeNull();
    expect(denied.status).toBe(429);
    const retryAfter = Number(denied.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(600);
    expect(denied.headers.get("X-IpCap-Limit")).toBe("3");
    expect(denied.headers.get("X-IpCap-Active")).toBe("4");
    const body = await denied.text();
    expect(body).toMatch(/IP cap exceeded/);
  });

  it("the same IP hammering counts once", async () => {
    const key = await makeKey("same-ip");
    for (let i = 0; i < 10; i++) {
      expect(await ipCap.enforceKeyIpCap(mockRequest(key.key, "192.168.1.1"))).toBeNull();
    }
    expect(await ipRepo.countActiveIps(key.id)).toBe(1);
  });

  it("::ffff:1.2.3.4 and 1.2.3.4 are the same client", async () => {
    const key = await makeKey("v4mapped");
    expect(await ipCap.enforceKeyIpCap(mockRequest(key.key, "::ffff:203.0.113.7"))).toBeNull();
    expect(await ipCap.enforceKeyIpCap(mockRequest(key.key, "203.0.113.7"))).toBeNull();
    expect(await ipRepo.countActiveIps(key.id)).toBe(1);
  });

  it("per-key maxIps override: 1 → 2nd IP is 429", async () => {
    const key = await makeKey("cap-1");
    await db.updateApiKey(key.id, { maxIps: 1 });
    expect(await ipCap.enforceKeyIpCap(mockRequest(key.key, "10.1.0.1"))).toBeNull();
    const denied = await ipCap.enforceKeyIpCap(mockRequest(key.key, "10.1.0.2"));
    expect(denied).not.toBeNull();
    expect(denied.status).toBe(429);
    expect(denied.headers.get("X-IpCap-Limit")).toBe("1");
  });

  it("an IP older than the 10-minute window no longer counts", async () => {
    const key = await makeKey("window");
    const past = Date.now() - WINDOW_MS - 60_000;
    await ipRepo.recordIpUsage(key.id, "10.2.0.1", past);
    await ipRepo.recordIpUsage(key.id, "10.2.0.2", past);
    await ipRepo.recordIpUsage(key.id, "10.2.0.3", past);
    // All three are stale: three fresh IPs must pass, the 4th is capped.
    for (const ip of ["10.2.1.1", "10.2.1.2", "10.2.1.3"]) {
      expect(await ipCap.enforceKeyIpCap(mockRequest(key.key, ip))).toBeNull();
    }
    expect(await ipCap.enforceKeyIpCap(mockRequest(key.key, "10.2.1.4"))).not.toBeNull();
    // The stale rows were pruned by the enforcement calls, and the
    // rejected 4th IP was NOT admitted (it must not poison the window).
    expect(await ipRepo.countActiveIps(key.id)).toBe(3);
    const rows = await ipRepo.getActiveIps(key.id);
    expect(rows.map((r) => r.ip)).not.toContain("10.2.0.1");
    expect(rows.map((r) => r.ip)).not.toContain("10.2.1.4");
    // …and the already-seen IPs still pass afterwards.
    expect(await ipCap.enforceKeyIpCap(mockRequest(key.key, "10.2.1.1"))).toBeNull();
  });

  it("getKeyIpStatus reports cap/source/active IPs", async () => {
    const key = await makeKey("status");
    await ipCap.enforceKeyIpCap(mockRequest(key.key, "10.3.0.1"));
    await ipCap.enforceKeyIpCap(mockRequest(key.key, "10.3.0.2"));
    const status = await ipCap.getKeyIpStatus(key.id);
    expect(status).toMatchObject({ keyId: key.id, cap: 3, source: "default", activeCount: 2 });
    expect(status.activeIps.map((r) => r.ip).sort()).toEqual(["10.3.0.1", "10.3.0.2"]);
    expect(status.resetAtMs).toBeGreaterThan(Date.now());
    await db.updateApiKey(key.id, { maxIps: 5 });
    const status2 = await ipCap.getKeyIpStatus(key.id);
    expect(status2).toMatchObject({ cap: 5, source: "key" });
    expect(await ipCap.getKeyIpStatus("missing-id")).toBeNull();
  });
});

describe("keyIpUsageRepo cleanup", () => {
  it("pruneStaleIpUsageForKey + sweepStaleIpUsage delete only stale rows", async () => {
    const key = await makeKey("cleanup");
    const now = Date.now();
    await ipRepo.recordIpUsage(key.id, "10.4.0.1", now - WINDOW_MS - 1000);
    await ipRepo.recordIpUsage(key.id, "10.4.0.2", now);
    expect(await ipRepo.pruneStaleIpUsageForKey(key.id, now)).toBe(1);
    expect(await ipRepo.countActiveIps(key.id, now)).toBe(1);
    await ipRepo.recordIpUsage(key.id, "10.4.0.3", now - WINDOW_MS - 1000);
    expect(await ipRepo.sweepStaleIpUsage(now)).toBe(1);
    expect(await ipRepo.countActiveIps(key.id, now)).toBe(1);
    expect(await ipRepo.deleteIpUsageForKey(key.id)).toBe(1);
    expect(await ipRepo.countActiveIps(key.id, now)).toBe(0);
  });
});

describe("apiKeysRepo maxIps round-trip", () => {
  it("maxIps survives update + export/import", async () => {
    const key = await makeKey("roundtrip");
    const updated = await db.updateApiKey(key.id, { maxIps: 7 });
    expect(updated.maxIps).toBe(7);
    const exported = await db.exportDb();
    const found = exported.apiKeys.find((k) => k.id === key.id);
    expect(found.maxIps).toBe(7);
    await db.importDb(exported);
    const restored = await db.getApiKeyById(key.id);
    expect(restored.maxIps).toBe(7);
  });
});
