// h-router Telegram bot — entry point.
// Separate Node process, polling first. Talks to the server ONLY over the
// internal HTTP API (/api/bot/*, service-secret guarded) — never the DB.
// Run:  TELEGRAM_BOT_TOKEN=... HROUTER_BOT_SECRET=... node src/bot-telegram/index.mjs
// Dry run (verify config + handler registration without polling):
//   HROUTER_BOT_DRY_RUN=1 node src/bot-telegram/index.mjs

import { Telegraf } from "telegraf";
import { loadConfig } from "./config.mjs";
import { BotApiClient } from "./api.mjs";
import { BotState } from "./state.mjs";
import { registerMemberHandlers } from "./handlers/member.mjs";
import { registerAdminHandlers } from "./handlers/admin.mjs";
import { startDigestScheduler } from "./digest.mjs";
import { createHealthProber } from "./healthProbe.mjs";
import { renderIncident } from "../lib/bot/compensation.mjs";
import { fmtDateWib } from "../lib/bot/format.mjs";

const config = loadConfig();
if (!config.ok) {
  console.error("[bot] konfigurasi tidak lengkap:");
  for (const e of config.errors) console.error(`  - ${e}`);
  console.error("[bot] lihat src/bot-telegram/README.md untuk cara menjalankan.");
  process.exit(1);
}

const api = new BotApiClient({ baseUrl: config.baseUrl, secret: config.secret });
const state = new BotState();
const runtime = {
  ownerChatId: config.ownerChatId || "",
  botUsername: config.botUsername || "",
  webUrl: config.webUrl,
};

// Resolve owner chat id + bot username from the server (env takes precedence).
async function loadServerConfig() {
  try {
    const server = await api.getConfig();
    if (!runtime.ownerChatId && server.ownerChatId) runtime.ownerChatId = String(server.ownerChatId);
    if (!runtime.botUsername && server.botUsername) runtime.botUsername = server.botUsername;
    console.log(`[bot] server OK (${config.baseUrl}) — owner chat ${runtime.ownerChatId ? "teratur" : "BELUM diatur"}, pembayaran ${server.paymentConfigured ? "teratur" : "BELUM diatur"}`);
  } catch (e) {
    console.error(`[bot] tidak bisa membaca konfigurasi server: ${e.message}`);
    console.error("[bot] pastikan server 9router berjalan dan HROUTER_BOT_SECRET sama dengan server.");
    throw e;
  }
}

const bot = new Telegraf(config.token);
registerMemberHandlers(bot, { api, state, runtime });
registerAdminHandlers(bot, { api, state, runtime });

bot.catch((err, ctx) => {
  console.error(`[bot] error pada update ${ctx?.update?.update_id}:`, err?.message || err);
});

async function main() {
  await loadServerConfig();

  if (config.dryRun) {
    console.log("[bot] dry-run OK — konfigurasi valid, handler terdaftar, polling tidak dijalankan.");
    process.exit(0);
  }

  const scheduler = startDigestScheduler({ bot, api, runtime });

  // Gateway-uptime prober (§0d): records incidents while the gateway is
  // down and alerts the owner on open/close. No auto-grants — the admin
  // grants compensation manually from /admin or the web panel.
  const prober = createHealthProber({
    baseUrl: config.baseUrl,
    api,
    intervalMs: config.probeIntervalMs,
    failuresToOpen: config.probeFailures,
    onIncidentOpened: async (incident) => {
      if (!runtime.ownerChatId) return;
      await bot.telegram.sendMessage(
        runtime.ownerChatId,
        `🚨 *Gangguan terdeteksi*\n\nGateway tidak bisa diakses sejak ${fmtDateWib(incident.startedAt)}.\nInsiden \`${incident.id.slice(0, 8)}\` dicatat — beri kompensasi dari /admin → Insiden & Kompensasi setelah gateway pulih.`,
        { parse_mode: "Markdown" }
      ).catch(() => {});
    },
    onIncidentClosed: async (incident) => {
      if (!runtime.ownerChatId) return;
      await bot.telegram.sendMessage(
        runtime.ownerChatId,
        `✅ *Gateway pulih*\n\n${renderIncident(incident)}\n\nBeri kompensasi ke kunci yang terdampak dari /admin → Insiden & Kompensasi.`,
        { parse_mode: "Markdown" }
      ).catch(() => {});
    },
  });
  prober.start();

  // Register bot commands so Telegram shows the Menu button (bottom-left)
  // with /start, /menu and /admin. Without this the client shows no menu.
  try {
    await bot.telegram.setMyCommands([
      { command: "start", description: "Mulai / tampilkan menu" },
      { command: "menu", description: "Tampilkan menu utama" },
      { command: "admin", description: "Panel admin (owner)" },
    ]);
    console.log("[bot] commands terdaftar (/start, /menu, /admin).");
  } catch (e) {
    console.error("[bot] gagal mendaftarkan commands:", e?.message || e);
  }

  await bot.launch();
  console.log("[bot] polling berjalan (Telegraf long-polling). Tekan Ctrl+C untuk berhenti.");

  const stop = async (signal) => {
    console.log(`[bot] ${signal} — berhenti…`);
    scheduler.stop();
    prober.stop();
    bot.stop(signal);
    process.exit(0);
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
}

main().catch((e) => {
  console.error("[bot] gagal start:", e?.message || e);
  process.exit(1);
});
