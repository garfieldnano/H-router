// Bot-side tests for downtime compensation (§0d): the health prober's
// streak state machine (injected probe fn, fake API — no network, no
// server) and the admin grant flow + member history handlers with mocked
// Telegraf contexts (no real token).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHealthProber } from "../../src/bot-telegram/healthProbe.mjs";
import { BotState } from "../../src/bot-telegram/state.mjs";
import { registerAdminHandlers } from "../../src/bot-telegram/handlers/admin.mjs";
import { registerMemberHandlers } from "../../src/bot-telegram/handlers/member.mjs";

const INCIDENT_ID = "11111111-1111-4111-8111-111111111111";
const MEMBER_ID = "22222222-2222-4222-8222-222222222222";
const KEY_ID = "33333333-3333-4333-8333-333333333333";

function makeFakeBot() {
  return {
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
    startPayload: "",
    match: null,
    message: null,
    reply: vi.fn(async () => ({})),
    answerCbQuery: vi.fn(async () => {}),
    telegram: { sendMessage: vi.fn(async () => ({ message_id: 777 })), sendPhoto: vi.fn(async () => ({})) },
    ...over,
  };
}

describe("health prober (injected probe, fake API)", () => {
  function setup(probeResults) {
    const calls = [];
    const api = {
      recordProbe: vi.fn(async (payload) => {
        calls.push(payload);
        if (payload.status === "down") {
          return calls.filter((c) => c.status === "down").length === 1
            ? { action: "opened", incident: { id: INCIDENT_ID, status: "open", startedAt: new Date().toISOString() } }
            : { action: "extended", incident: { id: INCIDENT_ID, status: "open" } };
        }
        return { action: "closed", incident: { id: INCIDENT_ID, status: "closed", startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), durationMinutes: 5 } };
      }),
    };
    let i = 0;
    const probeFn = async () => probeResults[Math.min(i++, probeResults.length - 1)];
    const opened = vi.fn();
    const closed = vi.fn();
    const prober = createHealthProber({
      baseUrl: "http://127.0.0.1:9",
      api,
      probeFn,
      onIncidentOpened: opened,
      onIncidentClosed: closed,
      failuresToOpen: 3,
    });
    return { prober, api, calls, opened, closed };
  }

  it("1–2 failures report nothing; the 3rd opens the incident", async () => {
    const { prober, api, opened } = setup([{ ok: false, reason: "unreachable" }]);
    await prober.tick();
    await prober.tick();
    expect(api.recordProbe).not.toHaveBeenCalled();
    await prober.tick();
    expect(api.recordProbe).toHaveBeenCalledTimes(1);
    expect(api.recordProbe).toHaveBeenCalledWith(expect.objectContaining({ status: "down", reason: "unreachable" }));
    expect(api.recordProbe.mock.calls[0][0].firstFailedAt).toBeTruthy();
    expect(opened).toHaveBeenCalledTimes(1);
    expect(prober.state.openIncidentId).toBe(INCIDENT_ID);
  });

  it("further failures keep extending the same incident (no second open)", async () => {
    const { prober, api, opened } = setup([{ ok: false, reason: "timeout" }]);
    for (let n = 0; n < 5; n++) await prober.tick();
    expect(api.recordProbe).toHaveBeenCalledTimes(3); // ticks 3, 4, 5
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it("recovery after failures reports 'up' and fires onIncidentClosed", async () => {
    const { prober, api, closed } = setup([
      { ok: false, reason: "unreachable" },
      { ok: false, reason: "unreachable" },
      { ok: false, reason: "unreachable" },
      { ok: true },
    ]);
    await prober.tick(); await prober.tick(); await prober.tick();
    await prober.tick();
    expect(api.recordProbe).toHaveBeenLastCalledWith(expect.objectContaining({ status: "up" }));
    expect(closed).toHaveBeenCalledTimes(1);
    expect(closed.mock.calls[0][0].durationMinutes).toBe(5);
    expect(prober.state.openIncidentId).toBeNull();
  });

  it("all-healthy ticks never touch the API", async () => {
    const { prober, api } = setup([{ ok: true }]);
    await prober.tick(); await prober.tick(); await prober.tick();
    expect(api.recordProbe).not.toHaveBeenCalled();
  });

  it("a lone failure streak that recovers before the threshold reports nothing", async () => {
    const { prober, api } = setup([{ ok: false }, { ok: false }, { ok: true }]);
    await prober.tick(); await prober.tick(); await prober.tick();
    expect(api.recordProbe).not.toHaveBeenCalled();
  });

  it("start() ticks on an interval and stop() halts it", async () => {
    const { prober, api } = setup([{ ok: true }]);
    const fast = createHealthProber({
      baseUrl: "http://127.0.0.1:9", api,
      probeFn: async () => ({ ok: true }),
      intervalMs: 15, failuresToOpen: 3,
    });
    fast.start();
    await new Promise((r) => setTimeout(r, 60));
    fast.stop();
    const ticksBefore = api.recordProbe.mock.calls.length;
    await new Promise((r) => setTimeout(r, 60));
    expect(api.recordProbe.mock.calls.length).toBe(ticksBefore);
    expect(prober).toBeTruthy();
  });
});

describe("admin incident handlers (mocked Telegram)", () => {
  let bot, api, state, runtime;

  beforeEach(() => {
    bot = makeFakeBot();
    state = new BotState();
    runtime = { ownerChatId: "123", botUsername: "hrouter_bot", webUrl: "http://127.0.0.1:20127" };
    api = {
      listIncidents: vi.fn(async () => ({ incidents: [{
        id: INCIDENT_ID, status: "closed", scope: "gateway", reason: "unreachable",
        startedAt: new Date(Date.now() - 150 * 60000).toISOString(),
        endedAt: new Date().toISOString(), durationMinutes: 150,
        derivedTierHours: 3, compensationsGranted: 0,
      }] })),
      getIncident: vi.fn(async () => ({
        incident: {
          id: INCIDENT_ID, status: "closed", scope: "gateway", reason: "unreachable",
          startedAt: new Date(Date.now() - 150 * 60000).toISOString(),
          endedAt: new Date().toISOString(), durationMinutes: 150, derivedTierHours: 3,
        },
        compensations: [],
      })),
      listMembers: vi.fn(async () => ({ members: [{
        id: MEMBER_ID, name: "Budi", email: "budi@example.local", isActive: true,
        keys: [{ id: KEY_ID, name: "Budi key", keyMasked: "h-router-***", isActive: true, expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString() }],
      }] })),
      grantCompensation: vi.fn(async () => ({
        compensation: { id: "c1", amount: 3, oldExpiresAt: new Date().toISOString(), newExpiresAt: new Date(Date.now() + 3 * 3600_000).toISOString() },
        key: { id: KEY_ID, name: "Budi key" },
        incident: { id: INCIDENT_ID, startedAt: new Date().toISOString() },
        derivedTierHours: 3, durationMinutes: 150, notifyChatId: "999",
      })),
      getOverview: vi.fn(async () => ({ members: 1, activeMembers: 1, apiKeys: 1, activeKeys: 1, pendingOrders: 0, totalOrders: 0 })),
    };
    registerAdminHandlers(bot, { api, state, runtime });
  });

  it("a:incidents lists incidents with tier + granted count", async () => {
    const fn = findAction(bot, "a:incidents");
    const ctx = makeCtx();
    await fn(ctx);
    expect(api.listIncidents).toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Insiden Gangguan"), expect.anything());
    // Tier + granted count render in the per-incident button, not the text.
    const keyboardJson = JSON.stringify(ctx.reply.mock.calls[0][1]);
    expect(keyboardJson).toContain("+3j");
    expect(keyboardJson).toContain("0 diberi");
  });

  it("inc:view shows the incident with a grant button", async () => {
    const fn = findAction(bot, /^inc:view:([0-9a-f-]{36})$/);
    const ctx = makeCtx({ match: [`inc:view:${INCIDENT_ID}`, INCIDENT_ID] });
    await fn(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("150 menit"), expect.anything());
  });

  it("full grant flow: incident → member → key → tier → apply + notify", async () => {
    const grant = findAction(bot, /^inc:grant:([0-9a-f-]{36})$/);
    await grant(makeCtx({ match: [`inc:grant:${INCIDENT_ID}`, INCIDENT_ID] }));
    expect(state.getGrant(123)?.incidentId).toBe(INCIDENT_ID);

    const pickMember = findAction(bot, /^inc:gm:([0-9a-f-]{36})$/);
    const ctxM = makeCtx({ match: [`inc:gm:${MEMBER_ID}`, MEMBER_ID] });
    await pickMember(ctxM);
    expect(ctxM.reply).toHaveBeenCalledWith(expect.stringContaining("Pilih kunci"), expect.anything());
    // The key name renders in the per-key button, not the message text.
    expect(JSON.stringify(ctxM.reply.mock.calls[0][1])).toContain("Budi key");

    const pickKey = findAction(bot, /^inc:gk:([0-9a-f-]{36})$/);
    await pickKey(makeCtx({ match: [`inc:gk:${KEY_ID}`, KEY_ID] }));
    expect(state.getGrant(123)?.keyId).toBe(KEY_ID);

    const apply = findAction(bot, /^inc:gt:([1358])$/);
    const ctxA = makeCtx({ match: ["inc:gt:3", "3"] });
    await apply(ctxA);
    expect(api.grantCompensation).toHaveBeenCalledWith(INCIDENT_ID, { keyId: KEY_ID, tierHours: 3 });
    expect(ctxA.reply).toHaveBeenCalledWith(expect.stringContaining("+3 jam"), expect.anything());
    // The linked member is notified.
    expect(ctxA.telegram.sendMessage).toHaveBeenCalledWith("999", expect.stringContaining("kompensasi"), expect.anything());
    expect(state.getGrant(123)).toBeNull();
  });

  it("grant failure surfaces the service error", async () => {
    api.grantCompensation = vi.fn(async () => { throw new Error("Kompensasi untuk insiden ini sudah pernah diberikan ke kunci ini"); });
    state.setGrant(123, { incidentId: INCIDENT_ID, keyId: KEY_ID });
    const apply = findAction(bot, /^inc:gt:([1358])$/);
    const ctx = makeCtx({ match: ["inc:gt:3", "3"] });
    await apply(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("sudah pernah diberikan"));
  });

  it("non-owner gets nothing from the incidents menu", async () => {
    const fn = findAction(bot, "a:incidents");
    const ctx = makeCtx({ chat: { id: 555 } });
    await fn(ctx);
    expect(api.listIncidents).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });
});

describe("member compensation history (mocked Telegram)", () => {
  it("m:comp renders the member's own history", async () => {
    const bot = makeFakeBot();
    const state = new BotState();
    const runtime = { ownerChatId: "123", botUsername: "hrouter_bot", webUrl: "http://127.0.0.1:20127" };
    const api = {
      resolveMember: vi.fn(async () => ({ member: { id: MEMBER_ID, name: "Budi" } })),
      getMemberCompensations: vi.fn(async () => ({ compensations: [{
        id: "c1", amount: 3, incidentId: INCIDENT_ID,
        grantedAt: new Date().toISOString(),
        newExpiresAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
      }] })),
      verifyLinkCode: vi.fn(), linkChat: vi.fn(), listPackages: vi.fn(),
      getMemberUsage: vi.fn(), getMemberDaily: vi.fn(), getMemberKeys: vi.fn(),
    };
    registerMemberHandlers(bot, { api, state, runtime });
    const fn = findAction(bot, "m:comp");
    expect(fn).toBeTruthy();
    const ctx = makeCtx();
    await fn(ctx);
    expect(api.getMemberCompensations).toHaveBeenCalledWith(MEMBER_ID);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("+3 jam"), expect.anything());
  });
});
