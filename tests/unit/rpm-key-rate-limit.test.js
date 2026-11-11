// RPM resolution chain + enforcement — DB-backed, isolated temp DATA_DIR.
// Chain: per-key rpmLimit → per-package rpmLimit → trial default 20 →
// global default (settings.defaultRpmLimit, 50). No unlimited tier.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-rpm-test-"));
let db;
let svc;
let rate;
let keyRate;

beforeAll(async () => {
  process.env.DATA_DIR = tmpDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  svc = await import("@/lib/bot/orderService.js");
  rate = await import("@/sse/services/rateLimit.js");
  keyRate = await import("@/sse/services/keyRateLimit.js");
  await db.initDb();
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

beforeEach(() => {
  rate.resetRateLimits();
});

function mockRequest(apiKey) {
  return {
    url: "http://localhost:20128/v1/chat/completions",
    headers: {
      get: (name) => {
        if (name.toLowerCase() === "authorization" && apiKey) return `Bearer ${apiKey}`;
        return null;
      },
    },
  };
}

async function makeKey(name = "Test key") {
  return db.createApiKey(name, "test-machine");
}

describe("resolveKeyRpmLimit — priority chain", () => {
  it("per-key limit wins over package and global", async () => {
    const pkg = await db.createPackage({ name: "Pro", price: 100, durationDays: 30, type: "paid", rpmLimit: 30 });
    const key = await makeKey();
    await db.updateApiKey(key.id, { rpmLimit: 10, packageId: pkg.id });
    const resolved = await keyRate.resolveKeyRpmLimit(await db.getApiKeyById(key.id));
    expect(resolved).toMatchObject({ limit: 10, source: "key", packageId: pkg.id });
  });

  it("package limit wins when the key has none", async () => {
    const pkg = await db.createPackage({ name: "Starter", price: 50, durationDays: 30, type: "paid", rpmLimit: 20 });
    const key = await makeKey();
    await db.updateApiKey(key.id, { packageId: pkg.id });
    const resolved = await keyRate.resolveKeyRpmLimit(await db.getApiKeyById(key.id));
    expect(resolved).toMatchObject({ limit: 20, source: "package", packageName: "Starter" });
  });

  it("trial package with no rpmLimit falls back to the trial default 20", async () => {
    const pkg = await db.createPackage({ name: "Trial X", price: 0, durationDays: 1, type: "trial" });
    expect(pkg.rpmLimit).toBe(20); // set at creation
    // ...and even if an admin clears it, the resolver still applies 20.
    await db.updatePackage(pkg.id, { rpmLimit: null });
    const key = await makeKey();
    await db.updateApiKey(key.id, { packageId: pkg.id });
    const resolved = await keyRate.resolveKeyRpmLimit(await db.getApiKeyById(key.id));
    expect(resolved).toMatchObject({ limit: 20, source: "trial-default" });
  });

  it("key with no package and no per-key limit gets the global default 50", async () => {
    const key = await makeKey();
    const resolved = await keyRate.resolveKeyRpmLimit(await db.getApiKeyById(key.id));
    expect(resolved).toMatchObject({ limit: 50, source: "global" });
  });

  it("global default follows settings.defaultRpmLimit (invalid → 50)", async () => {
    await db.updateSettings({ defaultRpmLimit: 7 });
    const key = await makeKey();
    expect((await keyRate.resolveKeyRpmLimit(await db.getApiKeyById(key.id))).limit).toBe(7);
    await db.updateSettings({ defaultRpmLimit: 0 });
    expect(keyRate.normalizeGlobalRpm(await db.getSettings())).toBe(50);
    await db.updateSettings({ defaultRpmLimit: 99999 });
    expect(keyRate.normalizeGlobalRpm(await db.getSettings())).toBe(50);
    await db.updateSettings({ defaultRpmLimit: 50 });
  });

  it("deleted package falls through to the global default", async () => {
    const pkg = await db.createPackage({ name: "Gone", price: 1, durationDays: 30, type: "paid", rpmLimit: 5 });
    const key = await makeKey();
    await db.updateApiKey(key.id, { packageId: pkg.id });
    await db.deletePackage(pkg.id);
    const resolved = await keyRate.resolveKeyRpmLimit(await db.getApiKeyById(key.id));
    expect(resolved).toMatchObject({ limit: 50, source: "global" });
  });
});

describe("packageId at issuance + lazy backfill", () => {
  it("order confirm records the package on the issued key", async () => {
    const pkg = await db.createPackage({ name: "Order RPM", price: 5000, durationDays: 30, type: "paid", rpmLimit: 30 });
    const order = await db.createOrder({
      buyerTelegramId: "77001", buyerTelegramUsername: "rpmbuyer", buyerName: "RPM Buyer",
      packageId: pkg.id, packageName: pkg.name, amount: pkg.price,
    });
    await db.updateOrder(order.id, { status: "pending_confirm" });
    const res = await svc.confirmOrder(order.id);
    expect(res.ok).toBe(true);
    const issued = await db.getApiKeyById(res.apiKey.id);
    expect(issued.packageId).toBe(pkg.id);
    const resolved = await keyRate.resolveKeyRpmLimit(issued);
    expect(resolved).toMatchObject({ limit: 30, source: "package" });
  });

  it("trial claim records the trial package on the issued key", async () => {
    // The active trial package is the earliest created one (getActiveTrialPackage
    // by design) — an earlier test already created one, so compare against it.
    const activeTrial = await db.getActiveTrialPackage();
    expect(activeTrial).not.toBe(null);
    await db.createPackage({ name: "Trial RPM", price: 0, durationDays: 1, type: "trial" });
    const res = await svc.claimTrial({ telegramId: "77002", username: "rpmtrial", firstName: "RPM Trial" });
    expect(res.ok).toBe(true);
    expect(res.pkg.id).toBe(activeTrial.id);
    const issued = await db.getApiKeyById(res.apiKey.id);
    expect(issued.packageId).toBe(activeTrial.id);
    expect((await keyRate.resolveKeyRpmLimit(issued)).limit).toBe(20);
  });

  it("pre-v5 key without packageId is backfilled from its confirmed order", async () => {
    const pkg = await db.createPackage({ name: "Legacy", price: 10, durationDays: 30, type: "paid", rpmLimit: 33 });
    const key = await makeKey("Legacy key");
    // Simulate a pre-v5 key: issued from an order, packageId never recorded.
    const order = await db.createOrder({
      buyerTelegramId: "77003", buyerTelegramUsername: "legacy", buyerName: "Legacy",
      packageId: pkg.id, packageName: pkg.name, amount: pkg.price,
    });
    await db.updateOrder(order.id, { status: "confirmed", keyId: key.id });
    expect((await db.getApiKeyById(key.id)).packageId).toBe(null);
    const resolved = await keyRate.resolveKeyRpmLimit(await db.getApiKeyById(key.id));
    expect(resolved).toMatchObject({ limit: 33, source: "package" });
    // Backfilled: the next read has the packageId stored.
    expect((await db.getApiKeyById(key.id)).packageId).toBe(pkg.id);
  });

  it("pre-v5 trial key is backfilled from its trial claim", async () => {
    await db.createPackage({ name: "Trial Legacy", price: 0, durationDays: 1, type: "trial" });
    // Backfill resolves to the earliest active trial package (by design).
    const activeTrial = await db.getActiveTrialPackage();
    expect(activeTrial).not.toBe(null);
    const member = await db.createMember({ name: "Legacy Trial", email: "legacy-trial@example.local" });
    const key = await makeKey("Legacy trial key");
    await db.createTrialClaim({ telegramId: "77004", memberId: member.id, keyId: key.id, expiresAt: new Date(Date.now() + 86400000).toISOString() });
    const resolved = await keyRate.resolveKeyRpmLimit(await db.getApiKeyById(key.id));
    expect(resolved).toMatchObject({ limit: 20, source: "trial-default" });
    expect((await db.getApiKeyById(key.id)).packageId).toBe(activeTrial.id);
  });
});

describe("enforceKeyRateLimit", () => {
  it("key with rpmLimit 2 → 3rd request in a minute gets 429 + Retry-After", async () => {
    const key = await makeKey("Limited key");
    await db.updateApiKey(key.id, { rpmLimit: 2 });
    const req = mockRequest(key.key);
    expect(await keyRate.enforceKeyRateLimit(req)).toBe(null);
    expect(await keyRate.enforceKeyRateLimit(req)).toBe(null);
    const blocked = await keyRate.enforceKeyRateLimit(req);
    expect(blocked).not.toBe(null);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toMatch(/^[1-9]\d*$/);
    expect(Number(blocked.headers.get("Retry-After"))).toBeLessThanOrEqual(60);
    const body = await blocked.json();
    expect(body.error.message).toMatch(/2 requests per minute/);
  });

  it("package-inherited limit is enforced the same way", async () => {
    const pkg = await db.createPackage({ name: "Pkg Limit", price: 10, durationDays: 30, type: "paid", rpmLimit: 1 });
    const key = await makeKey("Pkg key");
    await db.updateApiKey(key.id, { packageId: pkg.id });
    const req = mockRequest(key.key);
    expect(await keyRate.enforceKeyRateLimit(req)).toBe(null);
    const blocked = await keyRate.enforceKeyRateLimit(req);
    expect(blocked?.status).toBe(429);
  });

  it("no key → null (local mode, unlimited)", async () => {
    expect(await keyRate.enforceKeyRateLimit(mockRequest(null))).toBe(null);
  });

  it("unknown key → null (rejected elsewhere with 401, never 429 here)", async () => {
    expect(await keyRate.enforceKeyRateLimit(mockRequest("h-router-nope-nope-00000000"))).toBe(null);
  });

  it("inactive key → null", async () => {
    const key = await makeKey("Inactive key");
    await db.updateApiKey(key.id, { isActive: false, rpmLimit: 1 });
    expect(await keyRate.enforceKeyRateLimit(mockRequest(key.key))).toBe(null);
  });

  it("expired key → null", async () => {
    const key = await makeKey("Expired key");
    await db.updateApiKey(key.id, { rpmLimit: 1, expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(await keyRate.enforceKeyRateLimit(mockRequest(key.key))).toBe(null);
  });

  it("getKeyRateStatus reports limit + current-minute usage", async () => {
    const key = await makeKey("Status key");
    await db.updateApiKey(key.id, { rpmLimit: 5 });
    const req = mockRequest(key.key);
    await keyRate.enforceKeyRateLimit(req);
    await keyRate.enforceKeyRateLimit(req);
    const status = await keyRate.getKeyRateStatus(key.id);
    expect(status).toMatchObject({ keyId: key.id, limit: 5, source: "key", used: 2, remaining: 3 });
    expect(status.resetAtMs).toBeGreaterThan(Date.now());
    expect(await keyRate.getKeyRateStatus("no-such-id")).toBe(null);
  });
});

describe("repo validation", () => {
  it("package rpmLimit rejects 0 / out-of-range, accepts null (inherit)", async () => {
    await expect(db.createPackage({ name: "Bad", price: 1, durationDays: 30, type: "paid", rpmLimit: 0 })).rejects.toThrow();
    await expect(db.createPackage({ name: "Bad", price: 1, durationDays: 30, type: "paid", rpmLimit: 10001 })).rejects.toThrow();
    const pkg = await db.createPackage({ name: "Ok", price: 1, durationDays: 30, type: "paid" });
    expect(pkg.rpmLimit).toBe(null);
    const updated = await db.updatePackage(pkg.id, { rpmLimit: 42 });
    expect(updated.rpmLimit).toBe(42);
    const cleared = await db.updatePackage(pkg.id, { rpmLimit: null });
    expect(cleared.rpmLimit).toBe(null);
  });

  it("trial package created without rpmLimit gets 20", async () => {
    const pkg = await db.createPackage({ name: "Trial Auto", price: 0, durationDays: 1, type: "trial" });
    expect(pkg.rpmLimit).toBe(20);
  });

  it("exportDb round-trips rpmLimit + packageId", async () => {
    const pkg = await db.createPackage({ name: "Export", price: 1, durationDays: 30, type: "paid", rpmLimit: 44 });
    const key = await makeKey("Export key");
    await db.updateApiKey(key.id, { rpmLimit: 11, packageId: pkg.id });
    const out = await db.exportDb();
    const exportedKey = out.apiKeys.find((k) => k.id === key.id);
    expect(exportedKey).toMatchObject({ rpmLimit: 11, packageId: pkg.id });
    const exportedPkg = out.packages.find((p) => p.id === pkg.id);
    expect(exportedPkg.rpmLimit).toBe(44);
    await db.importDb(out);
    expect((await db.getApiKeyById(key.id)).rpmLimit).toBe(11);
    expect((await db.getPackageById(pkg.id)).rpmLimit).toBe(44);
  });
});
