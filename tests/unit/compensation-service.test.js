// DB-backed tests for downtime compensation (§0d): incident recording
// (probe open/close, error-rate signal) + manual grants (expiry extension,
// double-grant guard, refusal cases). Runs against an isolated temp
// DATA_DIR (never the real ~/.9router).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-comp-test-"));
let db;
let svc;
let adapter;

beforeAll(async () => {
  process.env.DATA_DIR = tmpDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  svc = await import("@/lib/bot/compensationService.js");
  const driver = await import("@/lib/db/driver.js");
  adapter = await driver.getAdapter();
  await db.initDb();
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

function minutesAgo(n) {
  return new Date(Date.now() - n * 60000).toISOString();
}

async function seedKey({ withExpiry = true, active = true } = {}) {
  const member = await db.createMember({ name: "Comp Member", email: `comp-${Math.random().toString(36).slice(2)}@example.local` });
  const key = await db.createApiKey("Comp key", "test-machine");
  const expiresAt = withExpiry ? new Date(Date.now() + 30 * 24 * 3600_000).toISOString() : null;
  await db.updateApiKey(key.id, { memberId: member.id, expiresAt, isActive: active });
  return { member, key: { ...key, memberId: member.id, expiresAt, isActive: active } };
}

function seedUsageRows({ errors, oks }) {
  const now = new Date().toISOString();
  for (let i = 0; i < errors; i++) {
    adapter.run(`INSERT INTO usageHistory(timestamp, status) VALUES(?, 'error')`, [now]);
  }
  for (let i = 0; i < oks; i++) {
    adapter.run(`INSERT INTO usageHistory(timestamp, status) VALUES(?, 'ok')`, [now]);
  }
}

describe("recordProbe — incident lifecycle", () => {
  it("down opens an incident (startedAt = first failure), repeat down extends it", async () => {
    const first = await svc.recordProbe({ status: "down", reason: "unreachable", firstFailedAt: minutesAgo(3) });
    expect(first.ok).toBe(true);
    expect(first.action).toBe("opened");
    expect(first.incident.status).toBe("open");
    expect(first.incident.startedAt).toBeTruthy();
    // startedAt = first failure (~3 min ago), not the moment the row opened.
    const startedMs = new Date(first.incident.startedAt).getTime();
    expect(Math.abs(startedMs - (Date.now() - 3 * 60000))).toBeLessThan(5000);
    const again = await svc.recordProbe({ status: "down", reason: "unreachable", firstFailedAt: minutesAgo(3) });
    expect(again.action).toBe("extended");
    expect(again.incident.id).toBe(first.incident.id);
    const open = await db.getOpenIncident("gateway");
    expect(open.id).toBe(first.incident.id);
    const closed = await svc.recordProbe({ status: "up" });
    expect(closed.action).toBe("closed");
    expect(closed.incident.status).toBe("closed");
    expect(closed.incident.durationMinutes).toBeGreaterThanOrEqual(3);
    expect(await db.getOpenIncident("gateway")).toBeNull();
  });

  it("up with no open incident is a no-op", async () => {
    const res = await svc.recordProbe({ status: "up" });
    expect(res.ok).toBe(true);
    expect(res.action).toBe("none");
    expect(res.incident).toBeNull();
  });

  it("invalid status is rejected", async () => {
    const res = await svc.recordProbe({ status: "maybe" });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
  });

  it("high recent error rate keeps/opens the incident even on an 'up' report", async () => {
    seedUsageRows({ errors: 12, oks: 3 }); // 80% errors, 15 requests
    const res = await svc.recordProbe({ status: "up" });
    expect(res.ok).toBe(true);
    expect(res.action).toBe("opened");
    expect(res.incident.reason).toBe("error-rate");
    expect(res.incident.status).toBe("open");
    // Low error rate afterwards closes it.
    adapter.run(`DELETE FROM usageHistory`);
    seedUsageRows({ errors: 1, oks: 19 }); // 5% errors
    const closed = await svc.recordProbe({ status: "up" });
    expect(closed.action).toBe("closed");
    expect(closed.incident.durationMinutes).toBeGreaterThanOrEqual(0);
    adapter.run(`DELETE FROM usageHistory`);
  });

  it("too few requests never triggers the error-rate signal", async () => {
    adapter.run(`DELETE FROM usageHistory`);
    seedUsageRows({ errors: 9, oks: 0 }); // 100% errors but only 9 requests
    const res = await svc.recordProbe({ status: "up" });
    expect(res.action).toBe("none");
    adapter.run(`DELETE FROM usageHistory`);
  });
});

describe("grantCompensation", () => {
  it("extends expiresAt by exactly the tier derived from the incident duration", async () => {
    const { member, key } = await seedKey();
    const incident = await db.createIncident({
      scope: "gateway", reason: "unreachable",
      startedAt: minutesAgo(150), // 2.5h outage → tier +3h
    });
    await db.closeIncident(incident.id, new Date().toISOString());
    const before = new Date(key.expiresAt).getTime();
    const res = await svc.grantCompensation({ incidentId: incident.id, keyId: key.id });
    expect(res.ok).toBe(true);
    expect(res.derivedTier).toBe(3);
    expect(res.compensation.amount).toBe(3);
    expect(res.compensation.type).toBe("hours");
    expect(res.compensation.memberId).toBe(member.id);
    const after = await db.getApiKeyById(key.id);
    expect(new Date(after.expiresAt).getTime() - before).toBe(3 * 3600_000);
    expect(res.compensation.newExpiresAt).toBe(after.expiresAt);
    expect(res.compensation.oldExpiresAt).toBe(key.expiresAt);
  });

  it("explicit tier overrides the derived tier", async () => {
    const { key } = await seedKey();
    const incident = await db.createIncident({ scope: "gateway", reason: "unreachable", startedAt: minutesAgo(30) });
    await db.closeIncident(incident.id, new Date().toISOString());
    const before = new Date(key.expiresAt).getTime();
    const res = await svc.grantCompensation({ incidentId: incident.id, keyId: key.id, tierHours: 8 });
    expect(res.ok).toBe(true);
    expect(res.derivedTier).toBe(1); // 30 min → +1h derived
    expect(res.compensation.amount).toBe(8); // …but 8 granted
    const after = await db.getApiKeyById(key.id);
    expect(new Date(after.expiresAt).getTime() - before).toBe(8 * 3600_000);
  });

  it("grants on an OPEN incident use the duration so far", async () => {
    const { key } = await seedKey();
    const incident = await db.createIncident({ scope: "gateway", reason: "unreachable", startedAt: minutesAgo(200) });
    const res = await svc.grantCompensation({ incidentId: incident.id, keyId: key.id });
    expect(res.ok).toBe(true);
    expect(res.derivedTier).toBe(5); // 200 min → +5h
    await db.closeIncident(incident.id, new Date().toISOString());
  });

  it("second grant for the same (incident, key) is refused (409)", async () => {
    const { key } = await seedKey();
    const incident = await db.createIncident({ scope: "gateway", reason: "unreachable", startedAt: minutesAgo(45) });
    await db.closeIncident(incident.id, new Date().toISOString());
    const first = await svc.grantCompensation({ incidentId: incident.id, keyId: key.id });
    expect(first.ok).toBe(true);
    const second = await svc.grantCompensation({ incidentId: incident.id, keyId: key.id });
    expect(second.ok).toBe(false);
    expect(second.status).toBe(409);
    expect(second.error).toMatch(/sudah pernah diberikan/);
    // …but the same key CAN be compensated for a different incident.
    const incident2 = await db.createIncident({ scope: "gateway", reason: "unreachable", startedAt: minutesAgo(45) });
    await db.closeIncident(incident2.id, new Date().toISOString());
    const other = await svc.grantCompensation({ incidentId: incident2.id, keyId: key.id });
    expect(other.ok).toBe(true);
  });

  it("key without expiresAt is refused with a clear error (no silent no-op)", async () => {
    const { key } = await seedKey({ withExpiry: false });
    const incident = await db.createIncident({ scope: "gateway", reason: "unreachable", startedAt: minutesAgo(45) });
    await db.closeIncident(incident.id, new Date().toISOString());
    const res = await svc.grantCompensation({ incidentId: incident.id, keyId: key.id });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(409);
    expect(res.error).toMatch(/tanpa expiresAt|tidak punya masa berlaku/);
  });

  it("inactive key is refused", async () => {
    const { key } = await seedKey({ active: false });
    const incident = await db.createIncident({ scope: "gateway", reason: "unreachable", startedAt: minutesAgo(45) });
    await db.closeIncident(incident.id, new Date().toISOString());
    const res = await svc.grantCompensation({ incidentId: incident.id, keyId: key.id });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(409);
    expect(res.error).toMatch(/nonaktif/);
  });

  it("unknown incident / key / invalid tier are refused", async () => {
    const { key } = await seedKey();
    const incident = await db.createIncident({ scope: "gateway", reason: "unreachable", startedAt: minutesAgo(45) });
    await db.closeIncident(incident.id, new Date().toISOString());
    expect((await svc.grantCompensation({ incidentId: "nope", keyId: key.id })).status).toBe(404);
    expect((await svc.grantCompensation({ incidentId: incident.id, keyId: "nope" })).status).toBe(404);
    const bad = await svc.grantCompensation({ incidentId: incident.id, keyId: key.id, tierHours: 2 });
    expect(bad.ok).toBe(false);
    expect(bad.status).toBe(400);
  });

  it("member history only shows that member's grants", async () => {
    const a = await seedKey();
    const b = await seedKey();
    const incident = await db.createIncident({ scope: "gateway", reason: "unreachable", startedAt: minutesAgo(45) });
    await db.closeIncident(incident.id, new Date().toISOString());
    await svc.grantCompensation({ incidentId: incident.id, keyId: a.key.id });
    const aHistory = await db.getCompensationsByMemberId(a.member.id);
    const bHistory = await db.getCompensationsByMemberId(b.member.id);
    expect(aHistory.length).toBe(1);
    expect(bHistory.length).toBe(0);
    expect(aHistory[0].incidentId).toBe(incident.id);
  });
});
