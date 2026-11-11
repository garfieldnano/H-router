// Member surface — mirrors the web member dashboard completely:
// usage (period filter), daily report, own keys (read-only, masked),
// buy a key, free trial, contact owner, account linking.
// Member scope stays read-only: own data only, enforced server-side.

import { Markup } from "telegraf";
import { renderUsageStats, renderKeys, renderPackages, fmtIdr, fmtDateWib } from "../../lib/bot/format.mjs";
import { renderPaymentDetails } from "../../lib/bot/payment.mjs";
import { renderCompensationHistory } from "../../lib/bot/compensation.mjs";

const PERIODS = [
  { value: "today", label: "Hari ini" },
  { value: "24h", label: "24 jam" },
  { value: "7d", label: "7 hari" },
  { value: "30d", label: "30 hari" },
  { value: "all", label: "Semua" },
];

function memberMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("📊 Penggunaan", "m:usage"), Markup.button.callback("📅 Laporan Harian", "m:daily")],
    [Markup.button.callback("🔑 Kunci Saya", "m:keys"), Markup.button.callback("🎁 Kompensasi", "m:comp")],
    [Markup.button.callback("🛒 Beli Kunci", "m:buy"), Markup.button.callback("🆓 Trial Gratis", "m:trial")],
    [Markup.button.callback("✉️ Hubungi Owner", "m:contact")],
  ]).reply_markup;
}

function publicMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🛒 Beli Kunci", "m:buy"), Markup.button.callback("🆓 Trial Gratis", "m:trial")],
    [Markup.button.callback("✉️ Hubungi Owner", "m:contact"), Markup.button.callback("🔗 Hubungkan Akun", "m:link")],
  ]).reply_markup;
}

export function registerMemberHandlers(bot, { api, state, runtime }) {
  const ownerChatId = () => runtime.ownerChatId;

  async function resolveMember(ctx) {
    try {
      const res = await api.resolveMember(ctx.chat.id);
      return res?.member || null;
    } catch {
      return null;
    }
  }

  async function showMenu(ctx, member) {
    if (member) {
      await ctx.reply(
        `👋 Halo *${member.name || "member"}*!\n\nMenu member h-router — penggunaan, kunci, dan pembelian.`,
        { parse_mode: "Markdown", reply_markup: memberMenuKeyboard() }
      );
    } else {
      await ctx.reply(
        "👋 Halo! Selamat datang di *h-router*.\n\nKamu belum menghubungkan akun member. Kamu tetap bisa beli paket atau klaim trial — akun member dibuat otomatis saat pembelian. Kalau sudah punya akun, hubungkan lewat dashboard member.",
        { parse_mode: "Markdown", reply_markup: publicMenuKeyboard() }
      );
    }
  }

  function fromParts(ctx) {
    const from = ctx.from || {};
    return { telegramId: ctx.chat.id, username: from.username || null, firstName: from.first_name || null };
  }

  bot.start(async (ctx) => {
    try {
      const payload = (ctx.startPayload || "").trim();
      if (payload) {
        // /start <link-code> — account linking from the member dashboard.
        try {
          const res = await api.verifyLinkCode({ code: payload, ...fromParts(ctx) });
          await ctx.reply(
            `✅ Akun Telegram berhasil dihubungkan ke member *${res.member.name || res.member.email}*.\n\nSekarang kamu bisa cek penggunaan dan kunci langsung dari sini.`,
            { parse_mode: "Markdown", reply_markup: memberMenuKeyboard() }
          );
        } catch (e) {
          await ctx.reply(`❌ Kode tidak bisa dipakai: ${e.message}\n\nMinta kode baru dari dashboard member (menu Hubungkan Telegram), kode hanya berlaku 10 menit.`);
        }
        return;
      }
      const member = await resolveMember(ctx);
      await showMenu(ctx, member);
    } catch (e) {
      await ctx.reply(`Terjadi kesalahan: ${e.message}`);
    }
  });

  // /menu — same as /start (no payload): show the main menu. Registered
  // via setMyCommands so Telegram shows the Menu button (bottom-left).
  bot.command("menu", async (ctx) => {
    try {
      const member = await resolveMember(ctx);
      await showMenu(ctx, member);
    } catch (e) {
      await ctx.reply(`Terjadi kesalahan: ${e.message}`);
    }
  });

  bot.action("m:menu", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const member = await resolveMember(ctx);
    await showMenu(ctx, member);
  });

  // ---------------------------------------------------------- usage
  bot.action("m:usage", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const member = await resolveMember(ctx);
    if (!member) {
      await ctx.reply("Fitur ini butuh akun member yang terhubung. Hubungkan dulu lewat dashboard member, atau beli paket — akun dibuat otomatis.");
      return;
    }
    const buttons = PERIODS.map((p) => Markup.button.callback(p.label, `m:usage:${p.value}`));
    await ctx.reply("Pilih periode penggunaan:", {
      reply_markup: Markup.inlineKeyboard([buttons.slice(0, 3), buttons.slice(3), [Markup.button.callback("⬅️ Menu", "m:menu")]]).reply_markup,
    });
  });

  bot.action(/^m:usage:(today|24h|7d|30d|all)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const period = ctx.match[1];
    const member = await resolveMember(ctx);
    if (!member) { await ctx.reply("Akun member belum terhubung."); return; }
    try {
      const stats = await api.getMemberUsage(member.id, period);
      const label = PERIODS.find((p) => p.value === period)?.label || period;
      await ctx.reply(renderUsageStats(stats, { title: "📊 Penggunaan", periodLabel: label }), { parse_mode: "Markdown" });
    } catch (e) {
      await ctx.reply(`Gagal memuat penggunaan: ${e.message}`);
    }
  });

  // ---------------------------------------------------------- daily report
  bot.action("m:daily", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const member = await resolveMember(ctx);
    if (!member) {
      await ctx.reply("Laporan harian butuh akun member yang terhubung. Hubungkan dulu lewat dashboard member.");
      return;
    }
    try {
      const report = await api.getMemberDaily(member.id);
      const { renderMemberDailyReport } = await import("../../lib/bot/digest.mjs");
      await ctx.reply(renderMemberDailyReport(report), { parse_mode: "Markdown" });
    } catch (e) {
      await ctx.reply(`Gagal memuat laporan harian: ${e.message}`);
    }
  });

  // ---------------------------------------------------------- compensation history (§0d)
  bot.action("m:comp", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const member = await resolveMember(ctx);
    if (!member) { await ctx.reply("Riwayat kompensasi butuh akun member yang terhubung. Hubungkan dulu lewat dashboard member."); return; }
    try {
      const res = await api.getMemberCompensations(member.id);
      await ctx.reply(renderCompensationHistory(res.compensations || []), { parse_mode: "Markdown" });
    } catch (e) {
      await ctx.reply(`Gagal memuat riwayat kompensasi: ${e.message}`);
    }
  });

  // ---------------------------------------------------------- keys
  bot.action("m:keys", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const member = await resolveMember(ctx);
    if (!member) { await ctx.reply("Akun member belum terhubung."); return; }
    try {
      const res = await api.getMemberKeys(member.id);
      await ctx.reply(`🔑 *Kunci API saya*\n\n${renderKeys(res.keys)}`, { parse_mode: "Markdown" });
    } catch (e) {
      await ctx.reply(`Gagal memuat kunci: ${e.message}`);
    }
  });

  // ---------------------------------------------------------- buy
  bot.action("m:buy", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    try {
      const res = await api.listPackages();
      const paid = (res.packages || []).filter((p) => p.type === "paid");
      if (!paid.length) {
        await ctx.reply("Belum ada paket berbayar yang tersedia. Hubungi owner untuk info paket.");
        return;
      }
      const buttons = paid.map((p) => [Markup.button.callback(`${p.name} — ${fmtIdr(p.price)}`, `buy:${p.id}`)]);
      buttons.push([Markup.button.callback("⬅️ Menu", "m:menu")]);
      await ctx.reply(`🛒 *Beli Kunci*\n\n${renderPackages(paid)}\n\nPilih paket untuk membuat order:`, {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
      });
    } catch (e) {
      await ctx.reply(`Gagal memuat paket: ${e.message}`);
    }
  });

  bot.action(/^buy:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const packageId = ctx.match[1];
    try {
      const who = fromParts(ctx);
      const res = await api.createOrder({ ...who, packageId });
      const { order, package: pkg } = res;
      state.setBuy(ctx.chat.id, { state: "proof_pending", orderId: order.id, packageId: pkg.id });
      let paymentText = "";
      try {
        const settings = await api.getAdminSettings();
        paymentText = renderPaymentDetails(settings?.telegramBot?.payment || {});
      } catch {
        paymentText = "⚠️ Detail pembayaran belum bisa dimuat — hubungi owner.";
      }
      await ctx.reply(
        `🧾 *Order dibuat*\n\nPaket: *${pkg.name}*\nJumlah: ${fmtIdr(order.amount)}\nOrder ID: \`${order.id.slice(0, 8)}\`\n\n${paymentText}\n\nKirim *foto bukti transfer* di chat ini. Admin akan memeriksa dan kunci dikirim otomatis setelah dikonfirmasi.`,
        { parse_mode: "Markdown" }
      );
    } catch (e) {
      await ctx.reply(`Gagal membuat order: ${e.message}`);
    }
  });

  // Payment proof photo — only while a buy is awaiting proof.
  bot.on("photo", async (ctx) => {
    const buy = state.getBuy(ctx.chat.id);
    if (!buy || buy.state !== "proof_pending") return;
    const photos = ctx.message.photo || [];
    const largest = photos[photos.length - 1];
    if (!largest?.file_id) return;
    try {
      const res = await api.uploadProof(buy.orderId, largest.file_id);
      state.clearBuy(ctx.chat.id);
      await ctx.reply(
        `✅ Bukti pembayaran diterima untuk order \`${res.order.id.slice(0, 8)}\`.\n\nStatus: menunggu konfirmasi admin. Kamu akan dikabari begitu admin mengonfirmasi — kunci langsung dikirim ke chat ini.`,
        { parse_mode: "Markdown" }
      );
      // Notify the owner.
      const owner = ownerChatId();
      if (owner) {
        const who = ctx.from?.username ? `@${ctx.from.username}` : `chat ${ctx.chat.id}`;
        await ctx.telegram.sendMessage(
          owner,
          `🔔 *Order baru menunggu konfirmasi*\n\nOrder: \`${res.order.id.slice(0, 8)}\`\nPembeli: ${who}\nPaket: ${res.order.packageName}\nJumlah: ${fmtIdr(res.order.amount)}`,
          {
            parse_mode: "Markdown",
            reply_markup: Markup.inlineKeyboard([
              [Markup.button.callback("✅ Konfirmasi", `ord:confirm:${res.order.id}`), Markup.button.callback("❌ Tolak", `ord:reject:${res.order.id}`)],
            ]).reply_markup,
          }
        ).catch(() => {});
        // Forward the proof photo so the admin can see it.
        await ctx.telegram.sendPhoto(owner, largest.file_id, { caption: `Bukti pembayaran order \`${res.order.id.slice(0, 8)}\`` }).catch(() => {});
      }
    } catch (e) {
      await ctx.reply(`Gagal mengirim bukti: ${e.message}`);
    }
  });

  // ---------------------------------------------------------- trial
  bot.action("m:trial", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    try {
      const who = fromParts(ctx);
      const res = await api.claimTrial(who);
      // Link the chat to the (possibly auto-created) member.
      try {
        await api.linkChat({ telegramId: who.telegramId, memberId: res.member.id, username: who.username, firstName: who.firstName });
      } catch { /* linking is best-effort here; the key is already issued */ }
      await ctx.reply(
        `🎉 *Trial aktif!*\n\nPaket: *${res.package.name}* (${res.package.durationDays} hari)\nBerakhir: ${fmtDateWib(res.apiKey.expiresAt)}\n\nKunci API kamu (simpan baik-baik, hanya ditampilkan sekali di sini):\n\`${res.apiKey.key}\`\n\nSetelah trial habis, kunci nonaktif otomatis — beli paket berbayar dari menu Beli Kunci untuk lanjut.`,
        { parse_mode: "Markdown" }
      );
    } catch (e) {
      await ctx.reply(`❌ ${e.message}`);
    }
  });

  // ---------------------------------------------------------- contact owner
  bot.action("m:contact", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!ownerChatId()) {
      await ctx.reply("Owner belum mengatur chat ID owner di bot. Coba lagi nanti.");
      return;
    }
    state.setPendingText(ctx.chat.id, { kind: "dm" });
    await ctx.reply("✉️ Tulis pesanmu untuk owner — pesan berikutnya yang kamu kirim akan diteruskan ke owner.");
  });

  bot.action("m:link", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await ctx.reply(
      "🔗 *Hubungkan Akun*\n\n1. Buka dashboard member di web dan login dengan API key kamu.\n2. Di halaman member, klik *Hubungkan Telegram* — kamu dapat kode 6 huruf.\n3. Kembali ke sini dan kirim /start <kode> (contoh: /start ABC123).\n\nKode hanya berlaku 10 menit dan sekali pakai.",
      { parse_mode: "Markdown" }
    );
  });

  // DM text → forward to owner (registered in index via pendingText kinds;
  // the handler itself lives here so the owner id is in scope).
  bot.on("text", async (ctx) => {
    const pending = state.getPendingText(ctx.chat.id);
    if (!pending || pending.kind !== "dm") return;
    const owner = ownerChatId();
    if (!owner) {
      state.clearPendingText(ctx.chat.id);
      await ctx.reply("Owner belum mengatur chat ID owner di bot. Coba lagi nanti.");
      return;
    }
    state.clearPendingText(ctx.chat.id);
    const who = ctx.from?.username ? `@${ctx.from.username}` : `chat ${ctx.chat.id}`;
    try {
      const sent = await ctx.telegram.sendMessage(
        owner,
        `💬 *Pesan dari ${who}*\n\n${ctx.message.text}\n\n_Balas pesan ini untuk menjawab._`,
        { parse_mode: "Markdown" }
      );
      state.setRelay(sent.message_id, ctx.chat.id);
      await ctx.reply("✅ Pesanmu diteruskan ke owner. Balasan owner akan masuk ke chat ini.");
    } catch (e) {
      await ctx.reply(`Gagal meneruskan pesan: ${e.message}`);
    }
  });
}
