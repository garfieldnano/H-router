// Bot admin RPM flows — mocked Telegraf contexts, no real token, no network.
// Verifies the owner-only RPM actions arm the text input and call the right
// internal-API methods (key / package / global), plus the RPM rendering.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { BotState } from "../../src/bot-telegram/state.mjs";
import { registerAdminHandlers } from "../../src/bot-telegram/handlers/admin.mjs";
import { renderRpm, renderKeys, renderPackage } from "../../src/lib/bot/format.mjs";

function makeFakeBot() {
  const bot = {
    actions: [],
    onHandlers: {},
    commands: {},
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
  return {
    chat: { id: 123 },
    from: { id: 123, username: "owner", first_name: "Owner" },
    match: null,
    message: null,
    reply: vi.fn(async () => ({})),
    answerCbQuery: vi.fn(async () => {}),
    telegram: { sendMessage: vi.fn(async () => ({ message_id: 777 })), sendPhoto: vi.fn(async () => ({})) },
    ...over,
  };
}

const OWNER = 123;
const KEY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PKG_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("admin RPM actions (mocked Telegram)", () => {
  let bot, api, state, runtime;

  beforeEach(() => {
    bot = makeFakeBot();
    state = new BotState();
    runtime = { ownerChatId: "123", botUsername: "hrouter_bot", webUrl: "http://127.0.0.1:20127" };
    api = {
      listKeys: vi.fn(async () => ({ keys: [
        { id: KEY_ID, name: "Key A", keyMasked: "h-router-***aaaa", memberName: "Andi", isActive: true, createdAt: new Date().toISOString(), expiresAt: null, rate: { limit: 20, source: "package", packageName: "Pro", used: 3, remaining: 17 } },
      ] })),
      toggleKey: vi.fn(async () => ({ key: { id: KEY_ID, name: "Key A", isActive: false } })),
      setKeyRpm: vi.fn(async () => ({ key: { id: KEY_ID, name: "Key A", rpmLimit: 25 } })),
      listAdminPackages: vi.fn(async () => ({ packages: [
        { id: PKG_ID, name: "Pro", price: 100000, durationDays: 30, type: "paid", rpmLimit: 30, isActive: true },
      ] })),
      updateAdminPackage: vi.fn(async (id, payload) => ({ package: { id: PKG_ID, name: "Pro", price: 100000, durationDays: 30, type: "paid", rpmLimit: payload.rpmLimit ?? 30, isActive: true } })),
      getAdminSettings: vi.fn(async () => ({ counts: { providers: 1, activeProviders: 1, proxyPools: 0, combos: 0 }, flags: {}, telegramBot: { payment: {} }, defaultRpmLimit: 50, recentLogs: [] })),
      setGlobalRpm: vi.fn(async (n) => ({ defaultRpmLimit: n })),
    };
    registerAdminHandlers(bot, { api, state, runtime });
  });

  it("keys list shows the effective RPM per key", async () => {
    const fn = findAction(bot, "a:keys");
    const ctx = makeCtx();
    await fn(ctx);
    const text = ctx.reply.mock.calls[0][0];
    expect(text).toMatch(/RPM: 3\/20 per menit \(batas paket — Pro\)/);
  });

  it("key:rpm arms the text input; a number sets the per-key RPM", async () => {
    const arm = findAction(bot, /^key:rpm:([0-9a-f-]{36})$/);
    const ctx = makeCtx({ match: [null, KEY_ID] });
    await arm(ctx);
    expect(state.getPendingText(OWNER)).toMatchObject({ kind: "key_rpm", keyId: KEY_ID });
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("RPM baru"), expect.anything());

    const textFn = bot.onHandlers.text;
    const tctx = makeCtx({ message: { text: "25" } });
    await textFn(tctx);
    expect(api.setKeyRpm).toHaveBeenCalledWith(KEY_ID, 25);
    expect(tctx.reply).toHaveBeenCalledWith(expect.stringContaining("25/menit"), expect.anything());
    expect(state.getPendingText(OWNER)).toBe(null);
  });

  it("key:rpm with 0 clears the override (inherit)", async () => {
    state.setPendingText(OWNER, { kind: "key_rpm", keyId: KEY_ID });
    const textFn = bot.onHandlers.text;
    const tctx = makeCtx({ message: { text: "0" } });
    await textFn(tctx);
    expect(api.setKeyRpm).toHaveBeenCalledWith(KEY_ID, null);
    expect(tctx.reply).toHaveBeenCalledWith(expect.stringContaining("dihapus"), expect.anything());
  });

  it("key:rpm rejects non-numbers without calling the API", async () => {
    state.setPendingText(OWNER, { kind: "key_rpm", keyId: KEY_ID });
    const textFn = bot.onHandlers.text;
    const tctx = makeCtx({ message: { text: "abc" } });
    await textFn(tctx);
    expect(api.setKeyRpm).not.toHaveBeenCalled();
    expect(tctx.reply).toHaveBeenCalledWith(expect.stringContaining("tidak valid"));
  });

  it("package_rpm sets the package default RPM; 0 clears it", async () => {
    state.setPendingText(OWNER, { kind: "package_rpm", packageId: PKG_ID });
    const textFn = bot.onHandlers.text;
    await textFn(makeCtx({ message: { text: "50" } }));
    expect(api.updateAdminPackage).toHaveBeenCalledWith(PKG_ID, { rpmLimit: 50 });

    state.setPendingText(OWNER, { kind: "package_rpm", packageId: PKG_ID });
    await textFn(makeCtx({ message: { text: "0" } }));
    expect(api.updateAdminPackage).toHaveBeenCalledWith(PKG_ID, { rpmLimit: null });
  });

  it("global_rpm sets the global default; 0 is rejected (no unlimited)", async () => {
    state.setPendingText(OWNER, { kind: "global_rpm" });
    const textFn = bot.onHandlers.text;
    await textFn(makeCtx({ message: { text: "40" } }));
    expect(api.setGlobalRpm).toHaveBeenCalledWith(40);

    state.setPendingText(OWNER, { kind: "global_rpm" });
    const tctx = makeCtx({ message: { text: "0" } });
    await textFn(tctx);
    expect(api.setGlobalRpm).toHaveBeenCalledTimes(1);
    expect(tctx.reply).toHaveBeenCalledWith(expect.stringContaining("tidak valid"));
  });

  it("non-owner gets silence on RPM actions", async () => {
    const arm = findAction(bot, /^key:rpm:([0-9a-f-]{36})$/);
    const ctx = makeCtx({ chat: { id: 999 }, from: { id: 999 }, match: [null, KEY_ID] });
    await arm(ctx);
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(state.getPendingText(999)).toBe(null);
  });
});

describe("RPM rendering (bot format)", () => {
  it("renderRpm shows used/limit + source", () => {
    expect(renderRpm({ limit: 20, source: "package", packageName: "Pro", used: 3, remaining: 17 }))
      .toBe("RPM: 3/20 per menit (batas paket — Pro)");
    expect(renderRpm({ limit: 50, source: "global", used: 0, remaining: 50 }))
      .toBe("RPM: 0/50 per menit (batas global)");
    expect(renderRpm({ limit: 20, source: "trial-default", used: 1, remaining: 19 }))
      .toBe("RPM: 1/20 per menit (batas default trial)");
    expect(renderRpm(null)).toBe("");
  });

  it("renderKeys appends the RPM line", () => {
    const out = renderKeys([{ name: "K", maskedKey: "h-router-***aaaa", isActive: true, createdAt: new Date().toISOString(), rate: { limit: 30, source: "key", used: 2, remaining: 28 } }]);
    expect(out).toMatch(/RPM: 2\/30 per menit \(batas per kunci\)/);
  });

  it("renderPackage shows the package RPM or 'ikut default'", () => {
    expect(renderPackage({ name: "Pro", price: 100000, durationDays: 30, type: "paid", rpmLimit: 30 }))
      .toMatch(/RPM: 30\/menit/);
    expect(renderPackage({ name: "Basic", price: 50000, durationDays: 30, type: "paid", rpmLimit: null }))
      .toMatch(/RPM: ikut default/);
  });
});
