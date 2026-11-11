// Daily digest scheduler — runs inside the bot process.
// Every morning ~08:00 WIB the owner gets yesterday's summary (total
// requests, tokens prompt/completion, cost, top models, most active
// members/keys). Also sweeps expired trial keys hourly and notifies the
// affected members.

import { msUntilNextDigest, renderDailyDigest } from "../lib/bot/digest.mjs";

const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export function startDigestScheduler({ bot, api, runtime, log = console.log }) {
  const ownerChatId = () => runtime.ownerChatId;
  let digestTimer = null;
  let sweepTimer = null;

  async function sendDigest() {
    const owner = ownerChatId();
    if (!owner) {
      log("[bot][digest] owner chat id belum diatur — digest dilewati");
      return;
    }
    try {
      const digest = await api.getDigest();
      await bot.telegram.sendMessage(owner, renderDailyDigest(digest), { parse_mode: "Markdown" });
      log(`[bot][digest] digest ${digest.label} terkirim ke owner`);
    } catch (e) {
      log(`[bot][digest] gagal mengirim digest: ${e.message}`);
    }
  }

  async function sweepTrials() {
    try {
      const res = await api.sweepTrials();
      const deactivated = res.deactivated || [];
      if (!deactivated.length) return;
      log(`[bot][sweep] ${deactivated.length} trial key kedaluwarsa dinonaktifkan`);
      for (const d of deactivated) {
        const chatId = d.chatId || d.telegramId;
        if (!chatId) continue;
        await bot.telegram.sendMessage(
          chatId,
          "⏰ *Trial kamu sudah berakhir.*\n\nKunci trial dinonaktifkan otomatis. Beli paket berbayar dari menu Beli Kunci untuk lanjut memakai H-router.",
          { parse_mode: "Markdown" }
        ).catch(() => {});
      }
    } catch (e) {
      log(`[bot][sweep] gagal: ${e.message}`);
    }
  }

  function scheduleNextDigest() {
    const ms = msUntilNextDigest(new Date());
    digestTimer = setTimeout(async () => {
      await sendDigest();
      scheduleNextDigest();
    }, ms);
    // Don't keep the process alive on this timer alone.
    digestTimer.unref?.();
    const mins = Math.round(ms / 60000);
    log(`[bot][digest] digest berikutnya dalam ~${mins} menit (08:00 WIB)`);
  }

  scheduleNextDigest();
  sweepTimer = setInterval(sweepTrials, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
  // Run one sweep shortly after boot so keys that expired while the bot
  // was down are deactivated promptly.
  setTimeout(sweepTrials, 30_000).unref?.();

  return {
    sendDigest,
    sweepTrials,
    stop() {
      clearTimeout(digestTimer);
      clearInterval(sweepTimer);
    },
  };
}
