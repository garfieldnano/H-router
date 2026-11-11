// Egress relay service (plan #1): candidate pools per provider, next-relay
// pick (skips tried + banned), auto-rotate switch, proxy-config patch.
// Runs against an isolated temp DATA_DIR.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-egress-svc-test-"));
let db;
let svc;

beforeAll(async () => {
  process.env.DATA_DIR = tmpDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  svc = await import("@/sse/services/egressRelay.js");
  await db.initDb();
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

let poolA;
let poolB;

async function seed() {
  poolA = await db.createProxyPool({ name: "relay-a", proxyUrl: "http://127.0.0.1:20129", type: "http" });
  poolB = await db.createProxyPool({ name: "relay-b", proxyUrl: "http://127.0.0.1:20130", type: "http" });
  // Two connections for provider "kimi", bound to different pools, in
  // priority order (pool A first).
  await db.createProviderConnection({
    provider: "kimi", authType: "apikey", name: "kimi-a", apiKey: "k-a",
    providerSpecificData: { proxyPoolId: poolA.id },
  });
  await db.createProviderConnection({
    provider: "kimi", authType: "apikey", name: "kimi-b", apiKey: "k-b",
    providerSpecificData: { proxyPoolId: poolB.id },
  });
  // A connection for another provider, bound to pool B (must not leak
  // into kimi's candidate set).
  await db.createProviderConnection({
    provider: "codebuddy-cn", authType: "oauth", name: "cb-a", email: "cb@example.local",
    providerSpecificData: { proxyPoolId: poolB.id },
  });
}

describe("egress relay service", () => {
  it("candidate pools = distinct poolIds bound to the provider's connections", async () => {
    await seed();
    expect(await svc.getCandidateRelayPoolIds("kimi")).toEqual([poolA.id, poolB.id]);
    expect(await svc.getCandidateRelayPoolIds("codebuddy-cn")).toEqual([poolB.id]);
    // noAuth free providers have no connections — every active pool is a
    // candidate (documented rotation-unit rule, plan #1). The fallback
    // follows getProxyPools order (updatedAt desc), not connection order.
    expect((await svc.getCandidateRelayPoolIds("opencode")).sort()).toEqual([poolA.id, poolB.id].sort());
  });

  it("pickNextRelayPool skips tried + banned pools", async () => {
    expect((await svc.pickNextRelayPool({ provider: "kimi", excludePoolIds: [] }))?.id).toBe(poolA.id);
    expect((await svc.pickNextRelayPool({ provider: "kimi", excludePoolIds: [poolA.id] }))?.id).toBe(poolB.id);
    expect(await svc.pickNextRelayPool({ provider: "kimi", excludePoolIds: [poolA.id, poolB.id] })).toBeNull();
    // Ban pool A → the pick skips it even without an explicit exclusion.
    await svc.markRelayBanned(poolA.id, { status: 403, code: null });
    expect((await svc.pickNextRelayPool({ provider: "kimi", excludePoolIds: [] }))?.id).toBe(poolB.id);
    await db.clearRelayBan(poolA.id);
    expect((await svc.pickNextRelayPool({ provider: "kimi", excludePoolIds: [] }))?.id).toBe(poolA.id);
  });

  it("resolveRelayProxyConfig returns the auth.js-shaped patch", async () => {
    const patch = await svc.resolveRelayProxyConfig(poolB.id);
    expect(patch).toMatchObject({
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://127.0.0.1:20130",
      connectionProxyPoolId: poolB.id,
      vercelRelayUrl: "",
      strictProxy: false,
    });
  });

  it("auto-rotate defaults ON and is switchable per provider", async () => {
    const settings = await db.getSettings();
    expect(svc.isEgressAutoRotateEnabled(settings, "kimi")).toBe(true);
    await db.updateSettings({ providerStrategies: { kimi: { autoRotate: false } } });
    const updated = await db.getSettings();
    expect(svc.isEgressAutoRotateEnabled(updated, "kimi")).toBe(false);
    // Other providers are unaffected.
    expect(svc.isEgressAutoRotateEnabled(updated, "codebuddy-cn")).toBe(true);
    await db.updateSettings({ providerStrategies: { kimi: { autoRotate: true } } });
    expect(svc.isEgressAutoRotateEnabled(await db.getSettings(), "kimi")).toBe(true);
  });

  it("recordRelaySuccess is best-effort and never throws", async () => {
    await expect(svc.recordRelaySuccess(null)).resolves.toBeNull();
    await expect(svc.recordRelaySuccess("pool-missing")).resolves.toBeTruthy();
  });
});
