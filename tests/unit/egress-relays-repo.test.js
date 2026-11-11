// Egress relay state repo (plan #1, schema v7): ban/cooldown bookkeeping
// in egress_relays. Runs against an isolated temp DATA_DIR.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-egress-test-"));
let db;

beforeAll(async () => {
  process.env.DATA_DIR = tmpDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe("egress_relays repo", () => {
  it("creates the v7 table on init (no row = never banned)", async () => {
    expect(await db.getRelayState("pool-never")).toBeNull();
    expect(await db.getBannedRelayPoolIds(["pool-never"])).toEqual([]);
  });

  it("markRelayBanned creates a row with a future bannedUntil + failCount 1", async () => {
    const row = await db.markRelayBanned("pool-a", { status: 403, code: "11128", cooldownMs: 5 * 60 * 1000 });
    expect(row.poolId).toBe("pool-a");
    expect(row.failCount).toBe(1);
    expect(row.lastBanStatus).toBe(403);
    expect(row.lastBanCode).toBe("11128");
    expect(new Date(row.bannedUntil).getTime()).toBeGreaterThan(Date.now() + 4 * 60 * 1000);
    expect(await db.getBannedRelayPoolIds(["pool-a", "pool-b"])).toEqual(["pool-a"]);
    expect(db.isRelayBanned(row)).toBe(true);
  });

  it("a second ban bumps failCount and extends the cooldown", async () => {
    const first = await db.getRelayState("pool-a");
    const second = await db.markRelayBanned("pool-a", { status: 403, code: null, cooldownMs: 5 * 60 * 1000 });
    expect(second.failCount).toBe(2);
    expect(new Date(second.bannedUntil).getTime()).toBeGreaterThanOrEqual(new Date(first.bannedUntil).getTime());
  });

  it("recordRelaySuccess resets the streak and stamps lastSuccessAt", async () => {
    const row = await db.recordRelaySuccess("pool-a");
    expect(row.failCount).toBe(0);
    expect(row.lastSuccessAt).toBeTruthy();
    // The ban cooldown still runs its course — success does not unban early.
    expect(db.isRelayBanned(await db.getRelayState("pool-a"))).toBe(true);
  });

  it("clearRelayBan lifts the ban immediately", async () => {
    const row = await db.clearRelayBan("pool-a");
    expect(row.bannedUntil).toBeNull();
    expect(row.failCount).toBe(0);
    expect(await db.getBannedRelayPoolIds(["pool-a"])).toEqual([]);
    expect(await db.clearRelayBan("pool-unknown")).toBeNull();
  });

  it("getRelayStates lists rows; export/import round-trips the state", async () => {
    await db.markRelayBanned("pool-b", { status: 403, code: null, cooldownMs: 60000 });
    const states = await db.getRelayStates();
    expect(states.map((s) => s.poolId).sort()).toEqual(["pool-a", "pool-b"]);
    const exported = await db.exportDb();
    expect(exported.egress_relays.map((r) => r.poolId).sort()).toEqual(["pool-a", "pool-b"]);
    await db.importDb(exported);
    const after = await db.getRelayState("pool-b");
    expect(after.failCount).toBe(1);
    expect(after.lastBanStatus).toBe(403);
  });
});
