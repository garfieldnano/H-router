// Bot handler wiring tests — mocked Telegraf contexts, no real token,
// no network. Verifies the member handlers call the right internal-API
// methods and move the buy state machine correctly.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { BotState } from "../../src/bot-telegram/state.mjs";
import { registerMemberHandlers } from "../../src/bot-telegram/handlers/member.mjs";

function makeFakeBot() {
  const bot = {
    startHandlers: [],
    actions: [],
    onHandlers: {},
    commands: {},
    start(fn) { this.startHandlers.push(fn); },
    action(pattern, fn) { this.actions.push({ pattern, fn }); },
    on(event, fn) { this.onHandlers[event] = fn; },
    command(name, fn) { this.commands[name] = fn; },
    catch() {},
  };
  return bot;
}

function findAction(bot, pattern) {
  const entry = bot.actions.find((a) =>
    (a.pattern instanceof RegExp ? a.pattern.source === pattern.source : a.pattern === pattern));
  return entry?.fn;
}

function makeCtx(over = {}) {
  const ctx = {
    chat: { id: 900001 },
    from: { id: 900001, username: "e2euser", first_name: "E2E" },
    startPayload: "",
    match: null,
    message: null,
    reply: vi.fn(async () => ({})),
    answerCbQuery: vi.fn(async () => {}),
    telegram: { sendMessage: vi.fn(async () => ({ message_id: 777 })), sendPhoto: vi.fn(async () => ({})) },
    ...over,
  };
  return ctx;
}

describe("member handlers (mocked Telegram)", () => {
  let bot, api, state, runtime;

  beforeEach(() => {
    bot = makeFakeBot();
    state = new BotState();
    runtime = { ownerChatId: "123", botUsername: "hrouter_bot", webUrl: "http://127.0.0.1:20127" };
    api = {
      resolveMember: vi.fn(async () => ({ member: null })),
      verifyLinkCode: vi.fn(async () => ({ member: { id: "m1", name: "Andi" } })),
      listPackages: vi.fn(async () => ({ packages: [{ id: "11111111-1111-4111-8111-111111111111", name: "Basic", price: 150000, durationDays: 30, type: "paid" }] })),
      createOrder: vi.fn(async () => ({ order: { id: "22222222-2222-4222-8222-222222222222", amount: 150000 }, package: { id: "11111111-1111-4111-8111-111111111111", name: "Basic" } })),
      uploadProof: vi.fn(async () => ({ order: { id: "22222222-2222-4222-8222-222222222222", status: "pending_confirm" } })),
      claimTrial: vi.fn(async () => ({ member: { id: "m2", name: "Trial" }, apiKey: { key: "h-router-aaaaaaaaaaaaaaaa-bbbbbb-cccccccc", expiresAt: new Date().toISOString() }, package: { name: "Trial", durationDays: 1 } })),
      linkChat: vi.fn(async () => ({ ok: true })),
      getAdminSettings: vi.fn(async () => ({ telegramBot: { payment: { bankName: "", accountNumber: "", accountName: "", ewalletName: "", ewalletNumber: "", notes: "" } } })),
      getMemberUsage: vi.fn(async () => ({ totalRequests: 0, totalTokens: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalCost: 0, byModel: {}, recentRequests: [] })),
      getMemberDaily: vi.fn(async () => ({ label: "2026-11-10", requests: 0, promptTokens: 0, completionTokens: 0, tokens: 0, cost: 0, models: [] })),
      getMemberKeys: vi.fn(async () => ({ keys: [] })),
    };
    registerMemberHandlers(bot, { api, state, runtime });
  });

  it("/start <code> verifies the link code and shows the member menu", async () => {
    const start = bot.startHandlers[0];
    const ctx = makeCtx({ startPayload: "ABC123" });
    await start(ctx);
    expect(api.verifyLinkCode).toHaveBeenCalledWith(expect.objectContaining({ code: "ABC123", telegramId: 900001 }));
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("berhasil dihubungkan"), expect.anything());
  });

  it("/start without code and unlinked shows the public menu", async () => {
    const start = bot.startHandlers[0];
    const ctx = makeCtx();
    await start(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("belum menghubungkan"), expect.anything());
  });

  it("buy callback creates an order and arms the proof state", async () => {
    const buy = findAction(bot, /^buy:([0-9a-f-]{36})$/);
    expect(buy).toBeTruthy();
    const ctx = makeCtx({ match: ["buy:11111111-1111-4111-8111-111111111111", "11111111-1111-4111-8111-111111111111"] });
    await buy(ctx);
    expect(api.createOrder).toHaveBeenCalledWith(expect.objectContaining({ telegramId: 900001, packageId: "11111111-1111-4111-8111-111111111111" }));
    const buyState = state.getBuy(900001);
    expect(buyState?.state).toBe("proof_pending");
    expect(buyState?.orderId).toBe("22222222-2222-4222-8222-222222222222");
    // Payment details not configured -> the message says so, never invents numbers.
    const text = ctx.reply.mock.calls[0][0];
    expect(text).toMatch(/belum diatur/i);
    expect(text).not.toContain("No. rekening");
    expect(text).not.toContain("E-wallet:");
  });

  it("photo while proof is pending uploads the proof and clears the state", async () => {
    state.setBuy(900001, { state: "proof_pending", orderId: "22222222-2222-4222-8222-222222222222", packageId: "11111111-1111-4111-8111-111111111111" });
    const photo = bot.onHandlers["photo"];
    expect(photo).toBeTruthy();
    const ctx = makeCtx({ message: { photo: [{ file_id: "small" }, { file_id: "large-file-id" }] } });
    await photo(ctx);
    expect(api.uploadProof).toHaveBeenCalledWith("22222222-2222-4222-8222-222222222222", "large-file-id");
    expect(state.getBuy(900001)).toBeNull();
    // Owner is notified with confirm/reject buttons.
    expect(ctx.telegram.sendMessage).toHaveBeenCalledWith("123", expect.stringContaining("menunggu konfirmasi"), expect.anything());
  });

  it("photo with no pending buy is ignored", async () => {
    const photo = bot.onHandlers["photo"];
    const ctx = makeCtx({ message: { photo: [{ file_id: "x" }] } });
    await photo(ctx);
    expect(api.uploadProof).not.toHaveBeenCalled();
  });

  it("trial claim issues the key and links the chat", async () => {
    const trial = findAction(bot, "m:trial");
    const ctx = makeCtx();
    await trial(ctx);
    expect(api.claimTrial).toHaveBeenCalledWith(expect.objectContaining({ telegramId: 900001 }));
    expect(api.linkChat).toHaveBeenCalledWith(expect.objectContaining({ telegramId: 900001, memberId: "m2" }));
    const text = ctx.reply.mock.calls[0][0];
    expect(text).toContain("h-router-aaaaaaaaaaaaaaaa-bbbbbb-cccccccc");
    expect(text).toMatch(/Trial aktif/);
  });

  it("trial failure surfaces the guard message", async () => {
    api.claimTrial.mockRejectedValueOnce(new Error("Kamu sudah pernah klaim trial."));
    const trial = findAction(bot, "m:trial");
    const ctx = makeCtx();
    await trial(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("sudah pernah klaim trial"));
  });

  it("usage action requires a linked member", async () => {
    const usage = findAction(bot, "m:usage");
    const ctx = makeCtx();
    await usage(ctx);
    expect(api.getMemberUsage).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("butuh akun member"));
  });

  it("daily report action renders the member's own report", async () => {
    api.resolveMember.mockResolvedValueOnce({ member: { id: "m1", name: "Andi" } });
    const daily = findAction(bot, "m:daily");
    const ctx = makeCtx();
    await daily(ctx);
    expect(api.getMemberDaily).toHaveBeenCalledWith("m1");
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Laporan Harian"), expect.anything());
  });
});
