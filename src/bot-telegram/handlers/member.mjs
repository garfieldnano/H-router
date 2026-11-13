// Member surface — AI Token Store main menu (PRD §5.1), adapted to what the
// H-router backend actually provides today.
//
// PRD menu:
//   🤖 AI TOKEN STORE — Welcome, {username}!
//   💰 Balance / 📦 Subscription / 🔑 API Keys
//   🛒 BUY CREDITS · 📦 SUBSCRIPTION PLANS · 🤖 AVAILABLE MODELS
//   🔑 MY API KEYS · 📊 USAGE STATISTICS · 🧾 TRANSACTION HISTORY
//   👤 MY ACCOUNT · 💬 CUSTOMER SUPPORT
//
// Adaptations ("sesuaikan"):
// - Balance is NOT shown: H-router has no wallet backend yet (PRD Phase 2).
//   Showing "Rp 0" would be fake data. The header shows the two real
//   status lines (Subscription from the active key's package, API Keys
//   count). Add the wallet to enable the Balance line.
// - SUBSCRIPTION PLANS = the paid packages (H-router has no separate
//   subscription object; a package purchase IS the subscription, with an
//   expiry on the issued key). The trial package is offered inside Plans.
// - TRANSACTION HISTORY = the member's orders (buy/trial), via
//   GET /api/bot/orders?memberId=.
// - H-router extras that have no PRD slot live one level down: Trial
//   (inside Plans), Daily Report + Compensation (inside My Account).
// Member scope stays read-only: own data only, enforced server-side.

import { Markup } from "telegraf";
import { renderUsageStats, renderKeys, renderPackages, fmtIdr, fmtDateWib } from "../../lib/bot/format.mjs";
import { renderPaymentDetails } from "../../lib/bot/payment.mjs";
import { renderCompensationHistory } from "../../lib/bot/compensation.mjs";
import { orderStatusLabel } from "../../lib/bot/orderFlow.mjs";

const PERIODS = [
  { value: "today", label: "Hari ini" },
  { value: "24h", label: "24 jam" },
  { value: "7d", label: "7 hari" },
  { value: "30d", label: "30 hari" },
  { value: "all", label: "Semua" },
];

// PRD §5.1 main menu — the 8 store buttons, 2 per row.
function memberMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🛒 BUY CREDITS", "m:buy"), Markup.button.callback("📦 SUBSCRIPTION PLANS", "m:plans")],
    [Markup.button.callback("🤖 AVAILABLE MODELS", "m:models"), Markup.button.callback("🔑 MY API KEYS", "m:keys")],
    [Markup.button.callback("📊 USAGE STATISTICS", "m:usage"), Markup.button.callback("🧾 TRANSACTION HISTORY", "m:tx")],
    [Markup.button.callback("👤 MY ACCOUNT", "m:account"), Markup.button.callback("💬 CUSTOMER SUPPORT", "m:contact")],
  ]).reply_markup;
}

// Same store front for visitors who have not linked an account yet —
// only the actions that work without a member, plus linking.
function publicMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🛒 BUY CREDITS", "m:buy"), Markup.button.callback("📦 SUBSCRIPTION PLANS", "m:plans")],
    [Markup.button.callback("🤖 AVAILABLE MODELS", "m:models"), Markup.button.callback("🆓 Trial Gratis", "m:trial")],
    [Markup.button.callback("💬 CUSTOMER SUPPORT", "m:contact"), Markup.button.callback("🔗 Hubungkan Akun", "m:link")],
  ]).reply_markup;
}

// Subscription status for the header: the active key with the furthest
// expiry wins. Returns { line, count } — count is the member's key total
// (null when the keys call failed, so the header shows "—" not a lie).
async function getSubscriptionLine(api, memberId) {
  try {
    const res = await api.getMemberKeys(memberId);
    const keys = res.keys || [];
    const active = keys.filter((k) => k.isActive && k.expiresAt);
    if (!active.length) return { line: "Tidak ada paket aktif", count: keys.length };
    active.sort((a, b) => new Date(b.expiresAt) - new Date(a.expiresAt));
    const top = active[0];
    const pkg = top.rate?.packageName || top.name || "Paket";
    return { line: `${pkg} — berakhir ${fmtDateWib(top.expiresAt, { withTime: false })}`, count: keys.length };
  } catch {
    return { line: "—", count: null };
  }
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
      const sub = await getSubscriptionLine(api, member.id);
      await ctx.reply(
        `🤖 *AI TOKEN STORE*\n\nWelcome, *${member.name || "member"}*!\n\n📦 Subscription: ${sub.line}\n🔑 API Keys: ${sub.count === null ? "—" : sub.count}\n\n━━━━━━━━━━━━━━━━`,
        { parse_mode: "Markdown", reply_markup: memberMenuKeyboard() }
      );
    } else {
      await ctx.reply(
        "🤖 *AI TOKEN STORE*\n\n👋 Halo! Selamat datang di *AI Token Store*.\n\nKamu belum menghubungkan akun member. Kamu tetap bisa beli paket atau klaim trial — akun member dibuat otomatis saat pembelian. Kalau sudah punya akun, hubungkan lewat dashboard member.",
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

  // ---------------------------------------------------------- buy credits (PRD §5.3)
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
      await ctx.reply(`🛒 *BUY CREDITS*\n\n${renderPackages(paid)}\n\nPilih paket untuk membuat order:`, {
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

  // ---------------------------------------------------------- subscription plans (PRD §8)
  // The paid packages ARE the subscription plans: buying one issues a key
  // with that package's duration. The trial package is offered here too.
  bot.action("m:plans", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    try {
      const res = await api.listPackages();
      const pkgs = res.packages || [];
      const paid = pkgs.filter((p) => p.type === "paid");
      const trial = pkgs.find((p) => p.type === "trial");
      if (!paid.length && !trial) {
        await ctx.reply("Belum ada paket subscription yang tersedia. Hubungi owner untuk info paket.");
        return;
      }
      const buttons = paid.map((p) => [Markup.button.callback(`${p.name} — ${fmtIdr(p.price)}`, `buy:${p.id}`)]);
      if (trial) buttons.push([Markup.button.callback(`🆓 ${trial.name} (Trial Gratis)`, "m:trial")]);
      buttons.push([Markup.button.callback("⬅️ Menu", "m:menu")]);
      await ctx.reply(`📦 *SUBSCRIPTION PLANS*\n\n${renderPackages(pkgs)}\n\nPilih paket untuk membuat order:`, {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
      });
    } catch (e) {
      await ctx.reply(`Gagal memuat paket: ${e.message}`);
    }
  });

  // ---------------------------------------------------------- available models (PRD §9)
  bot.action("m:models", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    try {
      const res = await api.listPublicModels();
      const models = res.data || [];
      if (!models.length) {
        await ctx.reply("Belum ada model AI yang tersedia.");
        return;
      }
      const byProvider = new Map();
      for (const m of models) {
        const provider = m.owned_by || "Lainnya";
        if (!byProvider.has(provider)) byProvider.set(provider, []);
        byProvider.get(provider).push(m.name || m.id);
      }
      const lines = [];
      for (const [provider, names] of byProvider) {
        lines.push(`*${provider}*`);
        for (const n of names.slice(0, 12)) lines.push(`• ${n}`);
        if (names.length > 12) lines.push(`• …dan ${names.length - 12} model lainnya`);
      }
      await ctx.reply(`🤖 *AVAILABLE MODELS (${models.length})*\n\n${lines.join("\n")}`, {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Menu", "m:menu")]]).reply_markup,
      });
    } catch (e) {
      await ctx.reply(`Gagal memuat model: ${e.message}`);
    }
  });

  // ---------------------------------------------------------- my api keys (PRD §10)
  bot.action("m:keys", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const member = await resolveMember(ctx);
    if (!member) { await ctx.reply("Akun member belum terhubung."); return; }
    try {
      const res = await api.getMemberKeys(member.id);
      await ctx.reply(`🔑 *MY API KEYS*\n\n${renderKeys(res.keys)}`, { parse_mode: "Markdown" });
    } catch (e) {
      await ctx.reply(`Gagal memuat kunci: ${e.message}`);
    }
  });

  // ---------------------------------------------------------- usage statistics
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

  // ---------------------------------------------------------- transaction history (PRD §7)
  bot.action("m:tx", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const member = await resolveMember(ctx);
    if (!member) {
      await ctx.reply("Riwayat transaksi butuh akun member yang terhubung. Hubungkan dulu lewat dashboard member, atau beli paket — akun dibuat otomatis.");
      return;
    }
    try {
      const res = await api.listMemberOrders(member.id);
      const orders = res.orders || [];
      if (!orders.length) {
        await ctx.reply("🧾 Belum ada transaksi.");
        return;
      }
      const lines = orders.slice(0, 10).map((o) => `• ${o.packageName || "Paket"} — ${fmtIdr(o.amount)} · ${orderStatusLabel(o.status)} · ${fmtDateWib(o.createdAt, { withTime: false })}`);
      await ctx.reply(`🧾 *TRANSACTION HISTORY*\n\n${lines.join("\n")}`, {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Menu", "m:menu")]]).reply_markup,
      });
    } catch (e) {
      await ctx.reply(`Gagal memuat riwayat transaksi: ${e.message}`);
    }
  });

  // ---------------------------------------------------------- my account
  bot.action("m:account", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const member = await resolveMember(ctx);
    if (!member) { await ctx.reply("Akun member belum terhubung."); return; }
    try {
      const sub = await getSubscriptionLine(api, member.id);
      await ctx.reply(
        `👤 *MY ACCOUNT*\n\nNama: ${member.name || "-"}\nEmail: ${member.email || "-"}\nStatus: ${member.isActive ? "✅ Aktif" : "⛔ Nonaktif"}\n\n📦 Subscription: ${sub.line}\n🔑 API Keys: ${sub.count === null ? "—" : sub.count}`,
        {
          parse_mode: "Markdown",
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback("📅 Laporan Harian", "m:daily"), Markup.button.callback("🎁 Kompensasi", "m:comp")],
            [Markup.button.callback("🔗 Hubungkan Akun", "m:link"), Markup.button.callback("⬅️ Menu", "m:menu")],
          ]).reply_markup,
        }
      );
    } catch (e) {
      await ctx.reply(`Gagal memuat akun: ${e.message}`);
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

  // ---------------------------------------------------------- contact owner (customer support)
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
