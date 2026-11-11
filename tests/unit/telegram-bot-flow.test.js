// Pure-logic tests for the Telegram bot: order/buy state machines,
// trial once-per-user guard, admin guard, payment details, formatting.
// No DB, no Telegram — imports the canonical .mjs modules directly.
import { describe, it, expect } from "vitest";
import {
  canTransition, nextStatuses, orderStatusLabel, buyCanTransition,
} from "../../src/lib/bot/orderFlow.mjs";
import { trialEligibility } from "../../src/lib/bot/trial.mjs";
import { isOwnerChatId } from "../../src/lib/bot/adminGuard.mjs";
import {
  isPaymentConfigured, renderPaymentDetails, getTelegramBotSettings,
} from "../../src/lib/bot/payment.mjs";
import { fmtIdr, fmtCost, fmtNum, renderUsageStats } from "../../src/lib/bot/format.mjs";

describe("order status machine", () => {
  it("pending_payment -> pending_confirm only", () => {
    expect(canTransition("pending_payment", "pending_confirm")).toBe(true);
    expect(canTransition("pending_payment", "confirmed")).toBe(false);
    expect(canTransition("pending_payment", "rejected")).toBe(false);
  });
  it("pending_confirm -> confirmed | rejected", () => {
    expect(canTransition("pending_confirm", "confirmed")).toBe(true);
    expect(canTransition("pending_confirm", "rejected")).toBe(true);
    expect(canTransition("pending_confirm", "pending_payment")).toBe(false);
  });
  it("confirmed / rejected are terminal", () => {
    expect(nextStatuses("confirmed")).toEqual([]);
    expect(nextStatuses("rejected")).toEqual([]);
    expect(canTransition("confirmed", "rejected")).toBe(false);
  });
  it("unknown statuses never transition", () => {
    expect(canTransition("bogus", "confirmed")).toBe(false);
    expect(canTransition("pending_payment", "bogus")).toBe(false);
  });
  it("labels exist for every status", () => {
    for (const s of ["pending_payment", "pending_confirm", "confirmed", "rejected"]) {
      expect(orderStatusLabel(s)).not.toBe(s);
    }
  });
});

describe("buy-flow state machine", () => {
  it("idle -> package_chosen -> proof_pending -> done -> idle", () => {
    expect(buyCanTransition("idle", "package_chosen")).toBe(true);
    expect(buyCanTransition("package_chosen", "proof_pending")).toBe(true);
    expect(buyCanTransition("proof_pending", "done")).toBe(true);
    expect(buyCanTransition("done", "idle")).toBe(true);
  });
  it("no skipping steps", () => {
    expect(buyCanTransition("idle", "proof_pending")).toBe(false);
    expect(buyCanTransition("idle", "done")).toBe(false);
    expect(buyCanTransition("package_chosen", "done")).toBe(false);
  });
  it("cancel returns to idle from any step", () => {
    expect(buyCanTransition("package_chosen", "idle")).toBe(true);
    expect(buyCanTransition("proof_pending", "idle")).toBe(true);
  });
});

describe("trial once-per-user guard", () => {
  const trialPkg = { id: "t1", name: "Trial", type: "trial", durationDays: 1 };
  it("allows a first claim when a trial package exists", () => {
    const r = trialEligibility({ telegramClaim: null, memberClaim: null, trialPackage: trialPkg });
    expect(r.ok).toBe(true);
  });
  it("rejects when no trial package exists", () => {
    const r = trialEligibility({ telegramClaim: null, memberClaim: null, trialPackage: null });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no_trial_package");
  });
  it("rejects a second claim by the same Telegram user", () => {
    const r = trialEligibility({
      telegramClaim: { claimedAt: new Date().toISOString() },
      memberClaim: null, trialPackage: trialPkg,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("already_claimed");
  });
  it("rejects when the member already claimed (different Telegram id)", () => {
    const r = trialEligibility({
      telegramClaim: null,
      memberClaim: { claimedAt: new Date().toISOString() },
      trialPackage: trialPkg,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("already_claimed_member");
  });
});

describe("admin guard", () => {
  it("only the exact owner chat id passes", () => {
    expect(isOwnerChatId(12345, "12345")).toBe(true);
    expect(isOwnerChatId("12345", 12345)).toBe(true);
    expect(isOwnerChatId(12346, "12345")).toBe(false);
    expect(isOwnerChatId(" 12345 ", "12345")).toBe(true);
  });
  it("no owner configured -> nobody is admin", () => {
    expect(isOwnerChatId(12345, "")).toBe(false);
    expect(isOwnerChatId(12345, null)).toBe(false);
    expect(isOwnerChatId(null, "12345")).toBe(false);
  });
});

describe("payment details", () => {
  it("empty settings -> not configured, never invents numbers", () => {
    const bot = getTelegramBotSettings({});
    expect(isPaymentConfigured(bot.payment)).toBe(false);
    const text = renderPaymentDetails(bot.payment);
    expect(text).toMatch(/belum diatur/i);
    expect(text).not.toMatch(/\d{6,}/);
  });
  it("bank-only config is enough", () => {
    const p = { bankName: "BCA", accountNumber: "1234567890", accountName: "John", ewalletName: "", ewalletNumber: "", notes: "" };
    expect(isPaymentConfigured(p)).toBe(true);
    const text = renderPaymentDetails(p);
    expect(text).toContain("1234567890");
    expect(text).toContain("BCA");
  });
  it("partial bank (no account number) is not configured", () => {
    const p = { bankName: "BCA", accountNumber: "", accountName: "John", ewalletName: "", ewalletNumber: "", notes: "" };
    expect(isPaymentConfigured(p)).toBe(false);
  });
  it("e-wallet-only config is enough", () => {
    const p = { bankName: "", accountNumber: "", accountName: "", ewalletName: "DANA", ewalletNumber: "08123456789", notes: "" };
    expect(isPaymentConfigured(p)).toBe(true);
  });
});

describe("formatting", () => {
  it("IDR formatting", () => {
    expect(fmtIdr(150000)).toBe("Rp150.000");
    expect(fmtIdr(0)).toBe("Rp0");
  });
  it("cost formatting", () => {
    expect(fmtCost(1.23456)).toBe("$1.2346");
  });
  it("usage stats render totals + top model", () => {
    const stats = {
      totalRequests: 3, totalTokens: 300, totalPromptTokens: 200, totalCompletionTokens: 100,
      totalCost: 0.5,
      byModel: { "a/b": { requests: 2, tokens: 200, cost: 0.4 }, "c/d": { requests: 1, tokens: 100, cost: 0.1 } },
      recentRequests: [{ timestamp: new Date().toISOString(), model: "a/b", promptTokens: 100, completionTokens: 50 }],
    };
    const text = renderUsageStats(stats, { title: "📊 Penggunaan", periodLabel: "Hari ini" });
    expect(text).toContain("Total request: 3");
    expect(text).toContain("Total token: 300");
    expect(text).toContain("a/b: 2 req");
  });
});
