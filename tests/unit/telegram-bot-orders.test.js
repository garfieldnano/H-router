// DB-backed tests for the Telegram bot service layer: packages, orders,
// trial claim guard, link codes, key expiry, usage-row windowing.
// Runs against an isolated temp DATA_DIR (never the real ~/.9router).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-bot-test-"));
let db;
let svc;
let adapter;

beforeAll(async () => {
  process.env.DATA_DIR = tmpDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  svc = await import("@/lib/bot/orderService.js");
  const driver = await import("@/lib/db/driver.js");
  adapter = await driver.getAdapter();
  await db.initDb();
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe("packages", () => {
  it("creates paid + trial packages; trial price is forced to 0", async () => {
    const paid = await db.createPackage({ name: "Basic 30 hari", price: 150000, durationDays: 30, type: "paid" });
    expect(paid.price).toBe(150000);
    expect(paid.type).toBe("paid");
    const trial = await db.createPackage({ name: "Trial", price: 99999, durationDays: 1, type: "trial" });
    expect(trial.price).toBe(0);
    expect(trial.type).toBe("trial");
    const activeTrial = await db.getActiveTrialPackage();
    expect(activeTrial.id).toBe(trial.id);
  });

  it("price edit persists (admin-configurable, not hardcoded)", async () => {
    const pkg = await db.createPackage({ name: "Pro 30 hari", price: 100000, durationDays: 30, type: "paid" });
    const updated = await db.updatePackage(pkg.id, { price: 250000 });
    expect(updated.price).toBe(250000);
    const again = await db.getPackageById(pkg.id);
    expect(again.price).toBe(250000);
  });

  it("rejects invalid input", async () => {
    await expect(db.createPackage({ name: "", price: 100, durationDays: 30, type: "paid" })).rejects.toThrow();
    await expect(db.createPackage({ name: "X", price: -1, durationDays: 30, type: "paid" })).rejects.toThrow();
    await expect(db.createPackage({ name: "X", price: 100, durationDays: 0, type: "paid" })).rejects.toThrow();
  });
});

describe("order confirm -> key issuance", () => {
  it("confirm issues a new h-router- key and auto-creates the member", async () => {
    const pkg = await db.createPackage({ name: "Order Test", price: 50000, durationDays: 30, type: "paid" });
    const order = await db.createOrder({
      buyerTelegramId: "111001", buyerTelegramUsername: "buyer1", buyerName: "Buyer Satu",
      packageId: pkg.id, packageName: pkg.name, amount: pkg.price,
    });
    expect(order.status).toBe("pending_payment");
    const proofed = await db.updateOrder(order.id, { status: "pending_confirm", proofFileId: "file-abc" });
    expect(proofed.status).toBe("pending_confirm");

    const result = await svc.confirmOrder(order.id);
    expect(result.ok).toBe(true);
    expect(result.order.status).toBe("confirmed");
    expect(result.apiKey.key.startsWith("h-router-")).toBe(true);
    expect(result.member).toBeTruthy();
    expect(result.order.memberId).toBe(result.member.id);
    expect(result.apiKey.memberId).toBe(result.member.id);
    // Key expiry = package duration (30 days from now).
    const expiresInDays = (new Date(result.apiKey.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(expiresInDays).toBeGreaterThan(29);
    expect(expiresInDays).toBeLessThanOrEqual(30);

    // Second confirm is rejected (terminal state).
    const again = await svc.confirmOrder(order.id);
    expect(again.ok).toBe(false);
    expect(again.status).toBe(409);
  });

  it("reject moves to rejected and cannot be confirmed after", async () => {
    const pkg = await db.createPackage({ name: "Reject Test", price: 10000, durationDays: 30, type: "paid" });
    const order = await db.createOrder({
      buyerTelegramId: "111002", buyerTelegramUsername: "buyer2", buyerName: "Buyer Dua",
      packageId: pkg.id, packageName: pkg.name, amount: pkg.price,
    });
    await db.updateOrder(order.id, { status: "pending_confirm", proofFileId: "file-def" });
    const rejected = await svc.rejectOrder(order.id, { note: "Bukti tidak jelas" });
    expect(rejected.ok).toBe(true);
    expect(rejected.order.status).toBe("rejected");
    const confirm = await svc.confirmOrder(order.id);
    expect(confirm.ok).toBe(false);
  });
});

describe("trial claim (once per user)", () => {
  it("first claim issues a 1-day key; second claim (same Telegram id) is rejected", async () => {
    const first = await svc.claimTrial({ telegramId: "222001", username: "trialuser", firstName: "Trial User" });
    expect(first.ok).toBe(true);
    expect(first.apiKey.key.startsWith("h-router-")).toBe(true);
    const expiresInHours = (new Date(first.apiKey.expiresAt).getTime() - Date.now()) / (60 * 60 * 1000);
    expect(expiresInHours).toBeGreaterThan(23);
    expect(expiresInHours).toBeLessThanOrEqual(24);

    const second = await svc.claimTrial({ telegramId: "222001", username: "trialuser", firstName: "Trial User" });
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("already_claimed");
  });

  it("same member via a different Telegram id is also rejected", async () => {
    // First claim created member M and linked chat 222001 -> M. Link a second
    // chat to the same member, then claim from it: the member guard fires.
    const first = await svc.claimTrial({ telegramId: "222002", username: "trial2", firstName: "Trial Dua" });
    expect(first.ok).toBe(true);
    await db.linkChat({ chatId: "222003", memberId: first.member.id, username: "trial2b", firstName: "Trial Dua B" });
    const second = await svc.claimTrial({ telegramId: "222003", username: "trial2b", firstName: "Trial Dua B" });
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("already_claimed_member");
  });
});

describe("link codes", () => {
  it("create -> consume once -> second consume fails", async () => {
    const member = await db.createMember({ name: "Link User", email: "link-user@example.test" });
    const link = await db.createLinkCode(member.id);
    expect(link.code).toMatch(/^[A-Z2-9]{6}$/);
    const consumed = await db.consumeLinkCode(link.code);
    expect(consumed.memberId).toBe(member.id);
    const again = await db.consumeLinkCode(link.code);
    expect(again).toBeNull();
  });

  it("expired code cannot be consumed", async () => {
    const member = await db.createMember({ name: "Link User 2", email: "link-user-2@example.test" });
    const link = await db.createLinkCode(member.id, { ttlMs: -1000 });
    const consumed = await db.consumeLinkCode(link.code);
    expect(consumed).toBeNull();
  });
});

describe("key expiry enforcement", () => {
  it("expired keys fail validation; future-expiry keys pass", async () => {
    const member = await db.createMember({ name: "Expiry User", email: "expiry@example.test" });
    const key = await db.createApiKey("Expiry Test", "0123456789abcdef");
    await db.setApiKeyMember(key.id, member.id);
    expect(await db.validateApiKey(key.key)).toBe(true);

    const past = new Date(Date.now() - 60_000).toISOString();
    await db.setApiKeyExpiry(key.id, past);
    expect(await db.validateApiKey(key.key)).toBe(false);

    const future = new Date(Date.now() + 60_000).toISOString();
    await db.setApiKeyExpiry(key.id, future);
    expect(await db.validateApiKey(key.key)).toBe(true);
  });

  it("trial sweep deactivates expired trial keys", async () => {
    const claimed = await svc.claimTrial({ telegramId: "222004", username: "sweepuser", firstName: "Sweep User" });
    expect(claimed.ok).toBe(true);
    // Force the trial key + claim into the past.
    const past = new Date(Date.now() - 60_000).toISOString();
    await db.setApiKeyExpiry(claimed.apiKey.id, past);
    adapter.run(`UPDATE trialClaims SET expiresAt = ? WHERE id = ?`, [past, claimed.claim.id]);
    const deactivated = await svc.sweepExpiredTrialKeys();
    expect(deactivated.some((d) => d.keyId === claimed.apiKey.id)).toBe(true);
    const keyAfter = await db.getApiKeyById(claimed.apiKey.id);
    expect(keyAfter.isActive).toBe(false);
    expect(await db.validateApiKey(claimed.apiKey.key)).toBe(false);
    // Second sweep finds nothing new.
    expect(await svc.sweepExpiredTrialKeys()).toEqual([]);
  });
});

describe("usage rows between (digest source)", () => {
  it("returns rows in the half-open WIB window, scoped by keys", async () => {
    const member = await db.createMember({ name: "Usage User", email: "usage@example.test" });
    const keyA = await db.createApiKey("Usage A", "aaaaaaaaaaaaaaaa");
    const keyB = await db.createApiKey("Usage B", "bbbbbbbbbbbbbbbb");
    await db.setApiKeyMember(keyA.id, member.id);
    await db.setApiKeyMember(keyB.id, member.id);
    const insert = (apiKey, ts, model, prompt, completion, cost, status = "ok") =>
      adapter.run(
        `INSERT INTO usageHistory(timestamp, provider, model, apiKey, promptTokens, completionTokens, cost, status) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
        [ts, "openai", model, apiKey, prompt, completion, cost, status]
      );
    // WIB day 2026-11-09 = 2026-11-08T17:00Z .. 2026-11-09T17:00Z
    insert(keyA.key, "2026-11-08T16:59:59.000Z", "a/x", 10, 5, 0.001); // before window
    insert(keyA.key, "2026-11-08T17:00:00.000Z", "a/x", 100, 50, 0.01); // window start (inclusive)
    insert(keyB.key, "2026-11-09T10:00:00.000Z", "b/y", 200, 100, 0.02);
    insert(keyB.key, "2026-11-09T17:00:00.000Z", "b/y", 999, 999, 9.99); // window end (exclusive)
    const rows = await db.getUsageRowsBetween("2026-11-08T17:00:00.000Z", "2026-11-09T17:00:00.000Z");
    expect(rows.map((r) => r.timestamp)).toEqual(["2026-11-08T17:00:00.000Z", "2026-11-09T10:00:00.000Z"]);
    expect(rows[0].promptTokens).toBe(100);
    expect(rows[0].completionTokens).toBe(50);
    // Member scoping: only keyA's rows.
    const scoped = await db.getUsageRowsBetween("2026-11-08T17:00:00.000Z", "2026-11-09T17:00:00.000Z", { apiKeys: [keyA.key] });
    expect(scoped.length).toBe(1);
    expect(scoped[0].apiKey).toBe(keyA.key);
  });
});
