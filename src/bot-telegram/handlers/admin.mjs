// Admin panel — owner chat ID only. Everyone else gets nothing: no admin
// menu, no hint it exists. Full mirror of the web admin surface: members,
// keys, orders, packages & prices, providers, proxy-pools, usage & quota,
// combos, token-saver, translator, skills, MITM, settings & database,
// console log. Edits that don't fit chat UI link back to the web.

import { Markup } from "telegraf";
import { isOwnerChatId } from "../../lib/bot/adminGuard.mjs";
import { renderUsageStats, renderPackages, renderRpm, fmtIdr, fmtDateWib, fmtNum } from "../../lib/bot/format.mjs";
import { renderDailyDigest } from "../../lib/bot/digest.mjs";
import { renderPaymentDetails } from "../../lib/bot/payment.mjs";
import { renderIncident, renderCompensationHistory } from "../../lib/bot/compensation.mjs";
import { orderStatusLabel } from "../../lib/bot/orderFlow.mjs";

const PERIODS = [
  { value: "today", label: "Hari ini" },
  { value: "24h", label: "24 jam" },
  { value: "7d", label: "7 hari" },
  { value: "30d", label: "30 hari" },
  { value: "all", label: "Semua" },
];

function adminMenuKeyboard(webUrl) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("📦 Order Masuk", "a:orders"), Markup.button.callback("👥 Member", "a:members")],
    [Markup.button.callback("🔑 Kunci", "a:keys"), Markup.button.callback("📦 Paket & Harga", "a:packages")],
    [Markup.button.callback("📊 Penggunaan", "a:usage"), Markup.button.callback("📬 Kirim Digest", "a:digest")],
    [Markup.button.callback("🚨 Insiden & Kompensasi", "a:incidents")],
    [Markup.button.callback("⚙️ Pengaturan", "a:settings"), Markup.button.callback("💳 Atur Pembayaran", "a:payment")],
    [Markup.button.url("🌐 Buka Dashboard Web", `${webUrl}/dashboard`)],
  ]).reply_markup;
}

export function registerAdminHandlers(bot, { api, state, runtime }) {
  const isOwner = (ctx) => isOwnerChatId(ctx.chat.id, runtime.ownerChatId);
  const webUrl = () => runtime.webUrl;

  // The owner may also open the panel with /admin. Non-owners get silence.
  bot.command("admin", async (ctx) => {
    if (!isOwner(ctx)) return;
    try {
      const res = await api.getOverview();
      await ctx.reply(
        `🛠️ *Panel Admin H-router*\n\nMember: ${fmtNum(res.members)} (${fmtNum(res.activeMembers)} aktif)\nKunci: ${fmtNum(res.apiKeys)} (${fmtNum(res.activeKeys)} aktif)\nOrder menunggu konfirmasi: ${fmtNum(res.pendingOrders)}\nTotal order: ${fmtNum(res.totalOrders)}`,
        { parse_mode: "Markdown", reply_markup: adminMenuKeyboard(webUrl()) }
      );
    } catch (e) {
      await ctx.reply(`Gagal memuat panel admin: ${e.message}`);
    }
  });

  bot.action("a:menu", async (ctx) => {
    if (!isOwner(ctx)) { await ctx.answerCbQuery().catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});
    await ctx.reply("🛠️ *Panel Admin H-router*", { parse_mode: "Markdown", reply_markup: adminMenuKeyboard(webUrl()) });
  });

  // ---------------------------------------------------------- orders
  bot.action("a:orders", async (ctx) => {
    if (!isOwner(ctx)) { await ctx.answerCbQuery().catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});
    try {
      const res = await api.listPendingOrders();
      const orders = res.orders || [];
      if (!orders.length) {
        await ctx.reply("📦 Tidak ada order yang menunggu konfirmasi.");
        return;
      }
      const buttons = orders.map((o) => [
        Markup.button.callback(`${o.packageName || "Paket"} — ${fmtIdr(o.amount)} (${o.buyerTelegramUsername ? "@" + o.buyerTelegramUsername : o.buyerTelegramId})`, `ord:view:${o.id}`),
      ]);
      buttons.push([Markup.button.callback("⬅️ Panel Admin", "a:menu")]);
      await ctx.reply(`📦 *Order menunggu konfirmasi (${orders.length})*`, {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
      });
    } catch (e) {
      await ctx.reply(`Gagal memuat order: ${e.message}`);
    }
  });

  bot.action(/^ord:view:([0-9a-f-]{36})$/, async (ctx) => {
    if (!isOwner(ctx)) { await ctx.answerCbQuery().catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});
    try {
      const { order } = await api.getOrder(ctx.match[1]);
      await ctx.reply(
        `🧾 *Order ${order.id.slice(0, 8)}*\n\nPembeli: ${order.buyerTelegramUsername ? "@" + order.buyerTelegramUsername : order.buyerTelegramId}${order.buyerName ? ` (${order.buyerName})` : ""}\nPaket: ${order.packageName}\nJumlah: ${fmtIdr(order.amount)}\nStatus: ${orderStatusLabel(order.status)}\nDibuat: ${fmtDateWib(order.createdAt)}${order.note ? `\nCatatan: ${order.note}` : ""}`,
        {
          parse_mode: "Markdown",
          reply_markup: order.status === "pending_confirm"
            ? Markup.inlineKeyboard([
              [Markup.button.callback("✅ Konfirmasi", `ord:confirm:${order.id}`), Markup.button.callback("❌ Tolak", `ord:reject:${order.id}`)],
              [Markup.button.callback("⬅️ Order Masuk", "a:orders")],
            ]).reply_markup
            : Markup.inlineKeyboard([[Markup.button.callback("⬅️ Order Masuk", "a:orders")]]).reply_markup,
        }
      );
      if (order.proofFileId) {
        await ctx.telegram.sendPhoto(ctx.chat.id, order.proofFileId, { caption: `Bukti pembayaran order ${order.id.slice(0, 8)}` }).catch(() => {});
      }
    } catch (e) {
      await ctx.reply(`Gagal memuat order: ${e.message}`);
    }
  });

  bot.action(/^ord:confirm:([0-9a-f-]{36})$/, async (ctx) => {
    if (!isOwner(ctx)) { await ctx.answerCbQuery().catch(() => {}); return; }
    await ctx.answerCbQuery("Mengonfirmasi…").catch(() => {});
    try {
      const res = await api.confirmOrder(ctx.match[1]);
      // Link the buyer's chat to the member so their menu works.
      try {
        await api.linkChat({ telegramId: res.order.buyerTelegramId, memberId: res.member.id });
      } catch { /* best-effort */ }
      // Deliver the key to the buyer (full key, shown once here).
      await ctx.telegram.sendMessage(
        res.order.buyerTelegramId,
        `🎉 *Pembayaran dikonfirmasi!*\n\nPaket: *${res.package.name}* (${res.package.durationDays} hari)\nBerakhir: ${fmtDateWib(res.apiKey.expiresAt)}\n\nKunci API kamu (simpan baik-baik):\n\`${res.apiKey.key}\`\n\nCek penggunaan dan kunci kapan saja dari menu bot.`,
        { parse_mode: "Markdown" }
      ).catch(() => {});
      await ctx.reply(`✅ Order \`${res.order.id.slice(0, 8)}\` dikonfirmasi — kunci sudah dikirim ke pembeli.`, { parse_mode: "Markdown" });
    } catch (e) {
      await ctx.reply(`❌ Gagal mengonfirmasi order: ${e.message}`);
    }
  });

  bot.action(/^ord:reject:([0-9a-f-]{36})$/, async (ctx) => {
    if (!isOwner(ctx)) { await ctx.answerCbQuery().catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});
    state.setPendingText(ctx.chat.id, { kind: "reject_reason", orderId: ctx.match[1] });
    await ctx.reply("❌ Tulis alasan penolakan — pesan berikutnya akan dikirim ke pembeli sebagai alasan.");
  });

  // ---------------------------------------------------------- members
  bot.action("a:members", async (ctx) => {
    if (!isOwner(ctx)) { await ctx.answerCbQuery().catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});
    try {
      const { members } = await api.listMembers();
      if (!members.length) { await ctx.reply("Belum ada member."); return; }
      const buttons = members.slice(0, 20).map((m) => [
        Markup.button.callback(`${m.isActive ? "✅" : "⛔"} ${m.name || m.email || m.id.slice(0, 8)} (${(m.keys || []).length} kunci)`, `mem:view:${m.id}`),
      ]);
      buttons.push([Markup.button.callback("⬅️ Panel Admin", "a:menu")]);
      await ctx.reply(`👥 *Member (${members.length})*`, {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
      });
    } catch (e) {
      await ctx.reply(`Gagal memuat member: ${e.message}`);
    }
  });

  bot.action(/^mem:view:([0-9a-f-]{36})$/, async (ctx) => {
    if (!isOwner(ctx)) { await ctx.answerCbQuery().catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});
    try {
      const { members } = await api.listMembers();
      const m = members.find((x) => x.id === ctx.match[1]);
      if (!m) { await ctx.reply("Member tidak ditemukan."); return; }
      const keys = (m.keys || []).map((k) => `• ${k.name || "Unnamed"} — \`${k.keyMasked}\` ${k.isActive ? "✅" : "⛔"}`).join("\n") || "Tidak ada kunci.";
      await ctx.reply(
        `👤 *${m.name || m.email}*\n\nEmail: ${m.email || "-"}\nStatus: ${m.isActive ? "✅ Aktif" : "⛔ Nonaktif"}\nDibuat: ${fmtDateWib(m.createdAt)}\n\nKunci:\n${keys}`,
        {
          parse_mode: "Markdown",
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(m.isActive ? "⛔ Nonaktifkan" : "✅ Aktifkan", `mem:toggle:${m.id}`)],
            [Markup.button.callback("⬅️ Member", "a:members")],
          ]).reply_markup,
        }
      );
    } catch (e) {
      await ctx.reply(`Gagal memuat member: ${e.message}`);
    }
  });

  bot.action(/^mem:toggle:([0-9a-f-]{36})$/, async (ctx) => {
    if (!isOwner(ctx)) { await ctx.answerCbQuery().catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});
    try {
      const { member } = await api.toggleMember(ctx.match[1]);
      await ctx.reply(`Member *${member.name || member.email}* sekarang ${member.isActive ? "✅ aktif" : "⛔ nonaktif"}.`, { parse_mode: "Markdown" });
    } catch (e) {
      await ctx.reply(`Gagal mengubah member: ${e.message}`);
    }
  });

  // ---------------------------------------------------------- keys
  bot.action("a:keys", async (ctx) => {
    if (!isOwner(ctx)) { await ctx.answerCbQuery().catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});
    try {
      const { keys } = await api.listKeys();
      if (!keys.length) { await ctx.reply("Belum ada kunci."); return; }
      const lines = keys.slice(0, 20).map((k) => `• ${k.name || "Unnamed"} — \`${k.keyMasked}\` (${k.memberName || "tanpa member"}) ${k.isActive ? "✅" : "⛔"}${k.expiresAt ? ` · berakhir ${fmtDateWib(k.expiresAt)}` : ""}${k.rate ? `\n  ${renderRpm(k.rate)}` : ""}`);
      const buttons = keys.slice(0, 10).map((k) => [
        Markup.button.callback(`${k.isActive ? "⛔" : "✅"} ${k.name || k.keyMasked}`, `key:toggle:${k.id}`),
        Markup.button.callback(`⚡ RPM`, `key:rpm:${k.id}`),
      ]);
      buttons.push([Markup.button.callback("⬅️ Panel Admin", "a:menu")]);
      await ctx.reply(`🔑 *Kunci (${keys.length})*\n\n${lines.join("\n")}\n\nTap tombol untuk mengaktifkan/menonaktifkan atau mengatur RPM (10 pertama):`, {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
      });
    } catch (e) {
      await ctx.reply(`Gagal memuat kunci: ${e.message}`);
    }
  });

  bot.action(/^key:rpm:([0-9a-f-]{36})$/, async (ctx) => {
    if (!isOwner(ctx)) { await ctx.answerCbQuery().catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});
    state.setPendingText(ctx.chat.id, { kind: "key_rpm", keyId: ctx.match[1] });
    await ctx.reply("⚡ Kirim RPM baru untuk kunci ini — angka 1–10000 per menit. Kirim *0* atau *kosong* untuk menghapus override (kunci ikut paket/global).", { parse_mode: "Markdown" });
  });

  bot.action(/^key:toggle:([0-9a-f-]{36})$/, async (ctx) => {
    if (!isOwner(ctx)) { await ctx.answerCbQuery().catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});
    try {
      const { key } = await api.toggleKey(ctx.match[1]);
      await ctx.reply(`Kunci *${key.name || key.id.slice(0, 8)}* sekarang ${key.isActive ? "✅ aktif" : "⛔ nonaktif"}.`, { parse_mode: "Markdown" });
    } catch (e) {
      await ctx.reply(`Gagal mengubah kunci: ${e.message}`);
    }
  });

  // ---------------------------------------------------------- packages
  bot.action("a:packages", async (ctx) => {
    if (!isOwner(ctx)) { await ctx.answerCbQuery().catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});
    try {
      const { packages } = await api.listAdminPackages();
      if (!packages.length) { await ctx.reply("Belum ada paket. Buat paket dari dashboard web (/dashboard/packages)."); return; }
      const buttons = packages.map((p) => [
        Markup.button.callback(`${p.isActive ? "✅" : "⛔"} ${p.name} — ${fmtIdr(p.price)}`, `pkg:view:${p.id}`),
      ]);
      buttons.push([Markup.button.callback("⬅️ Panel Admin", "a:menu")]);
      await ctx.reply(`📦 *Paket & Harga (${packages.length})*\n\n${renderPackages(packages)}`, {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
      });
    } catch (e) {
      await ctx.reply(`Gagal memuat paket: ${e.message}`);
    }
  });

  bot.action(/^pkg:view:([0-9a-f-]{36})$/, async (ctx) => {
    if (!isOwner(ctx)) { await ctx.answerCbQuery().catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});
    try {
      const { packages } = await api.listAdminPackages();
      const p = packages.find((x) => x.id === ctx.match[1]);
      if (!p) { await ctx.reply("Paket tidak ditemukan."); return; }
      await ctx.reply(
        `📦 *${p.name}*\n\nHarga: ${fmtIdr(p.price)}\nDurasi: ${p.durationDays} hari\nTipe: ${p.type === "trial" ? "🆓 Trial" : "💎 Berbayar"}\nRPM: ${p.rpmLimit != null ? `${p.rpmLimit}/menit` : p.type === "trial" ? "20/menit (default trial)" : "ikut global"}\nStatus: ${p.isActive ? "✅ Aktif" : "⛔ Nonaktif"}`,
        {
          parse_mode: "Markdown",
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback("✏️ Ubah Harga", `pkg:price:${p.id}`), Markup.button.callback(p.isActive ? "⛔ Nonaktifkan" : "✅ Aktifkan", `pkg:toggle:${p.id}`)],
            [Markup.button.callback("⚡ Atur RPM", `pkg:rpm:${p.id}`)],
            [Markup.button.callback("⬅️ Paket & Harga", "a:packages")],
          ]).reply_markup,
        }
      );
    } catch (e) {
      await ctx.reply(`Gagal memuat paket: ${e.message}`);
    }
  });

  bot.action(/^pkg:rpm:([0-9a-f-]{36})$/, async (ctx) => {
    if (!isOwner(ctx)) { await ctx.answerCbQuery().catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});
    state.setPendingText(ctx.chat.id, { kind: "package_rpm", packageId: ctx.match[1] });
    await ctx.reply("⚡ Kirim RPM default baru untuk paket ini — angka 1–10000 per menit. Kirim *0* atau *kosong* untuk menghapus (trial → 20, berbayar → ikut global).", { parse_mode: "Markdown" });
  });

  bot.action(/^pkg:price:([0-9a-f-]{36})$/, async (ctx) => {
    if (!isOwner(ctx)) { await ctx.answerCbQuery().catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});
    state.setPendingText(ctx.chat.id, { kind: "price", packageId: ctx.match[1] });
    await ctx.reply("✏️ Kirim harga baru dalam rupiah — angka saja, contoh: 150000 (boleh pakai titik: 150.000).");
  });

  bot.action(/^pkg:toggle:([0-9a-f-]{36})$/, async (ctx) => {
    if (!isOwner(ctx)) { await ctx.answerCbQuery().catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});
    try {
      const { packages } = await api.listAdminPackages();
      const p = packages.find((x) => x.id === ctx.match[1]);
      if (!p) { await ctx.reply("Paket tidak ditemukan."); return; }
      const updated = await api.updateAdminPackage(p.id, { isActive: !p.isActive });
      await ctx.reply(`Paket *${updated.package.name}* sekarang ${updated.package.isActive ? "✅ aktif" : "⛔ nonaktif"}.`, { parse_mode: "Markdown" });
    } catch (e) {
      await ctx.reply(`Gagal mengubah paket: ${e.message}`);
    }
  });

  // ---------------------------------------------------------- usage
  bot.action("a:usage", async (ctx) => {
    if (!isOwner(ctx)) { await ctx.answerCbQuery().catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});
    const buttons = PERIODS.map((p) => Markup.button.callback(p.label, `a:usage:${p.value}`));
    await ctx.reply("Penggunaan global — pilih periode:", {
      reply_markup: Markup.inlineKeyboard([buttons.slice(0, 3), buttons.slice(3), [Markup.button.callback("⬅️ Panel Admin", "a:menu")]]).reply_markup,
    });
  });

  bot.action(/^a:usage:(today|24h|7d|30d|all)$/, async (ctx) => {
    if (!isOwner(ctx)) { await ctx.answerCbQuery().catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});
    const period = ctx.match[1];
    try {
      const stats = await api.getAdminUsage(period);
      const label = PERIODS.find((p) => p.value === period)?.label || period;
      await ctx.reply(renderUsageStats(stats, { title: "📊 Penggunaan Global", periodLabel: label }), { parse_mode: "Markdown" });
    } catch (e) {
      await ctx.reply(`Gagal memuat penggunaan: ${e.message}`);
    }
  });

  // ---------------------------------------------------------- digest
  bot.action("a:digest", async (ctx) => {
    if (!isOwner(ctx)) { await ctx.answerCbQuery().catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});
    try {
      const digest = await api.getDigest();
      await ctx.reply(renderDailyDigest(digest), { parse_mode: "Markdown" });
    } catch (e) {
      await ctx.reply(`Gagal memuat digest: ${e.message}`);
    }
  });

  // ---------------------------------------------------------- incidents & compensation (§0d)
  bot.action("a:incidents", async (ctx) => {
    if (!isOwner(ctx)) { await ctx.answerCbQuery().catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});
    try {
      const { incidents } = await api.listIncidents();
      if (!incidents.length) {
        await ctx.reply("🚨 Belum ada insiden gangguan yang tercatat.");
        return;
      }
      const buttons = incidents.slice(0, 15).map((i) => [
        Markup.button.callback(
          `${i.status === "open" ? "🔴" : "✅"} ${fmtDateWib(i.startedAt, { withTime: false })} · ${i.durationMinutes ?? "?"} mnt · +${i.derivedTierHours}j (${i.compensationsGranted} diberi)`,
          `inc:view:${i.id}`
        ),
      ]);
      buttons.push([Markup.button.callback("⬅️ Panel Admin", "a:menu")]);
      await ctx.reply(`🚨 *Insiden Gangguan (${incidents.length})*\n\nInsiden dicatat otomatis oleh pemantau uptime gateway. Kompensasi diberikan manual oleh admin — pilih insiden untuk memberi kompensasi.`, {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
      });
    } catch (e) {
      await ctx.reply(`Gagal memuat insiden: ${e.message}`);
    }
  });

  bot.action(/^inc:view:([0-9a-f-]{36})$/, async (ctx) => {
    if (!isOwner(ctx)) { await ctx.answerCbQuery().catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});
    try {
      const { incident, compensations } = await api.getIncident(ctx.match[1]);
      const given = compensations.map((c) => `• +${c.amount} jam → kunci \`${c.keyId.slice(0, 8)}\` (${fmtDateWib(c.grantedAt)})`).join("\n");
      await ctx.reply(
        `${renderIncident(incident, { compensations })}${given ? `\n\n*Sudah diberikan:*\n${given}` : ""}`,
        {
          parse_mode: "Markdown",
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback("➕ Beri Kompensasi", `inc:grant:${incident.id}`)],
            [Markup.button.callback("⬅️ Insiden", "a:incidents")],
          ]).reply_markup,
        }
      );
    } catch (e) {
      await ctx.reply(`Gagal memuat insiden: ${e.message}`);
    }
  });

  // Grant flow: incident → member → key (eligible only) → tier → apply.
  // The pending grant lives in bot state (callback data is capped at 64
  // bytes, too small for two UUIDs).
  bot.action(/^inc:grant:([0-9a-f-]{36})$/, async (ctx) => {
    if (!isOwner(ctx)) { await ctx.answerCbQuery().catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});
    state.setGrant(ctx.chat.id, { incidentId: ctx.match[1] });
    try {
      const { members } = await api.listMembers();
      if (!members.length) { await ctx.reply("Belum ada member."); return; }
      const buttons = members.slice(0, 20).map((m) => [
        Markup.button.callback(`${m.name || m.email || m.id.slice(0, 8)} (${(m.keys || []).length} kunci)`, `inc:gm:${m.id}`),
      ]);
      buttons.push([Markup.button.callback("⬅️ Insiden", "a:incidents")]);
      await ctx.reply("Pilih member yang kuncinya mau diberi kompensasi:", {
        reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
      });
    } catch (e) {
      await ctx.reply(`Gagal memuat member: ${e.message}`);
    }
  });

  bot.action(/^inc:gm:([0-9a-f-]{36})$/, async (ctx) => {
    if (!isOwner(ctx)) { await ctx.answerCbQuery().catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});
    const grant = state.getGrant(ctx.chat.id);
    if (!grant?.incidentId) { await ctx.reply("Sesi pemberian kompensasi sudah habis — mulai lagi dari menu Insiden."); return; }
    try {
      const { members } = await api.listMembers();
      const m = members.find((x) => x.id === ctx.match[1]);
      if (!m) { await ctx.reply("Member tidak ditemukan."); return; }
      state.setGrant(ctx.chat.id, { ...grant, memberId: m.id });
      const keys = m.keys || [];
      const eligible = keys.filter((k) => k.isActive && k.expiresAt);
      const ineligible = keys.filter((k) => !(k.isActive && k.expiresAt));
      if (!eligible.length) {
        await ctx.reply(
          `Member *${m.name || m.email}* tidak punya kunci yang bisa diberi kompensasi.\n\nKunci harus aktif DAN punya masa berlaku (expiresAt).${ineligible.length ? `\n\nKunci yang tidak memenuhi syarat: ${ineligible.map((k) => k.name || k.keyMasked).join(", ")}` : ""}`,
          { parse_mode: "Markdown" }
        );
        return;
      }
      const buttons = eligible.map((k) => [
        Markup.button.callback(`${k.name || k.keyMasked} — berakhir ${fmtDateWib(k.expiresAt)}`, `inc:gk:${k.id}`),
      ]);
      buttons.push([Markup.button.callback("⬅️ Insiden", "a:incidents")]);
      await ctx.reply(`Pilih kunci milik *${m.name || m.email}* yang diberi kompensasi:`, {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
      });
    } catch (e) {
      await ctx.reply(`Gagal memuat kunci member: ${e.message}`);
    }
  });

  bot.action(/^inc:gk:([0-9a-f-]{36})$/, async (ctx) => {
    if (!isOwner(ctx)) { await ctx.answerCbQuery().catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});
    const grant = state.getGrant(ctx.chat.id);
    if (!grant?.incidentId) { await ctx.reply("Sesi pemberian kompensasi sudah habis — mulai lagi dari menu Insiden."); return; }
    try {
      const { incident } = await api.getIncident(grant.incidentId);
      state.setGrant(ctx.chat.id, { ...grant, keyId: ctx.match[1] });
      const derived = incident.derivedTierHours;
      const tierButtons = [1, 3, 5, 8].map((h) => Markup.button.callback(
        h === derived ? `⭐ +${h} jam (dari durasi)` : `+${h} jam`,
        `inc:gt:${h}`
      ));
      await ctx.reply(
        `Pilih besaran kompensasi untuk insiden ini:\n\nDurasi gangguan: ${incident.durationMinutes ?? "?"} menit → tier dari durasi: *+${derived} jam*.\n\nPilih tier lain kalau perlu, atau pakai tier dari durasi.`,
        {
          parse_mode: "Markdown",
          reply_markup: Markup.inlineKeyboard([tierButtons.slice(0, 2), tierButtons.slice(2), [Markup.button.callback("⬅️ Insiden", "a:incidents")]]).reply_markup,
        }
      );
    } catch (e) {
      await ctx.reply(`Gagal memuat insiden: ${e.message}`);
    }
  });

  bot.action(/^inc:gt:([1358])$/, async (ctx) => {
    if (!isOwner(ctx)) { await ctx.answerCbQuery().catch(() => {}); return; }
    await ctx.answerCbQuery("Memberi kompensasi…").catch(() => {});
    const grant = state.getGrant(ctx.chat.id);
    if (!grant?.incidentId || !grant?.keyId) {
      await ctx.reply("Sesi pemberian kompensasi sudah habis — mulai lagi dari menu Insiden.");
      return;
    }
    state.clearGrant(ctx.chat.id);
    try {
      const res = await api.grantCompensation(grant.incidentId, { keyId: grant.keyId, tierHours: Number(ctx.match[1]) });
      const c = res.compensation;
      await ctx.reply(
        `✅ *Kompensasi diberikan*\n\nKunci: \`${res.key.name || res.key.id.slice(0, 8)}\`\nTambahan: *+${c.amount} jam*\nMasa berlaku lama: ${fmtDateWib(c.oldExpiresAt)}\nMasa berlaku baru: ${fmtDateWib(c.newExpiresAt)}\nInsiden: ${res.incident.id.slice(0, 8)} (${res.durationMinutes ?? "?"} menit)`,
        { parse_mode: "Markdown" }
      );
      // Notify the member if their Telegram chat is linked.
      if (res.notifyChatId) {
        await ctx.telegram.sendMessage(
          res.notifyChatId,
          `🎁 *Kamu mendapat kompensasi!*\n\nKarena gangguan pada ${fmtDateWib(res.incident.startedAt, { withTime: false })}, masa aktif kunci kamu diperpanjang *+${c.amount} jam*.\n\nMasa berlaku baru: ${fmtDateWib(c.newExpiresAt)}`,
          { parse_mode: "Markdown" }
        ).catch(() => {});
      }
    } catch (e) {
      await ctx.reply(`❌ Gagal memberi kompensasi: ${e.message}`);
    }
  });

  // ---------------------------------------------------------- settings
  bot.action("a:settings", async (ctx) => {
    if (!isOwner(ctx)) { await ctx.answerCbQuery().catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});
    try {
      const s = await api.getAdminSettings();
      const w = webUrl();
      await ctx.reply(
        `⚙️ *Pengaturan*\n\nProvider: ${fmtNum(s.counts.providers)} (${fmtNum(s.counts.activeProviders)} aktif)\nProxy pools: ${fmtNum(s.counts.proxyPools)}\nCombos: ${fmtNum(s.counts.combos)}\nRPM global: ${s.defaultRpmLimit ?? 50}/menit\nLogin wajib: ${s.flags.requireLogin ? "ya" : "tidak"} · API key wajib: ${s.flags.requireApiKey ? "ya" : "tidak"}\nToken saver (RTK): ${s.flags.rtkEnabled ? "aktif" : "nonaktif"}\nPembayaran: ${renderPaymentDetails(s.telegramBot?.payment || {}).split("\n")[0]}\n\nLog request terbaru:`,
        {
          parse_mode: "Markdown",
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.url("Providers", `${w}/dashboard/providers`), Markup.button.url("Proxy Pools", `${w}/dashboard/proxy-pools`)],
            [Markup.button.url("Token Saver", `${w}/dashboard/token-saver`), Markup.button.url("Translator", `${w}/dashboard/translator`)],
            [Markup.button.url("Skills", `${w}/dashboard/skills`), Markup.button.url("MITM", `${w}/dashboard/mitm`)],
            [Markup.button.url("Console Log", `${w}/dashboard/console-log`), Markup.button.url("Pengaturan Web", `${w}/dashboard/profile`)],
            [Markup.button.callback("⚡ RPM Global", "a:globalrpm")],
            [Markup.button.callback("⬅️ Panel Admin", "a:menu")],
          ]).reply_markup,
        }
      );
      const logs = s.recentLogs || [];
      if (logs.length) {
        const lines = logs.slice(0, 8).map((l) => `• ${fmtDateWib(l.timestamp)} — ${l.model || "-"} · ${fmtNum((l.promptTokens || 0) + (l.completionTokens || 0))} token · ${l.status || ""}`);
        await ctx.reply(lines.join("\n"));
      }
    } catch (e) {
      await ctx.reply(`Gagal memuat pengaturan: ${e.message}`);
    }
  });

  // ---------------------------------------------------------- global RPM
  bot.action("a:globalrpm", async (ctx) => {
    if (!isOwner(ctx)) { await ctx.answerCbQuery().catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});
    state.setPendingText(ctx.chat.id, { kind: "global_rpm" });
    await ctx.reply("⚡ Kirim RPM global baru — angka 1–10000 request per menit. Ini dipakai kunci tanpa batas per kunci/paket. Tidak ada unlimited.");
  });

  // ---------------------------------------------------------- payment setup
  bot.action("a:payment", async (ctx) => {
    if (!isOwner(ctx)) { await ctx.answerCbQuery().catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});
    state.setPendingText(ctx.chat.id, { kind: "payment" });
    await ctx.reply(
      "💳 *Atur Pembayaran (transfer manual)*\n\nKirim detail dalam satu pesan, satu baris per field:\n\n```\nBank: BCA\nRek: 1234567890\nNama: John Doe\nEwallet: DANA\nNomor: 08123456789\nCatatan: Konfirmasi maks 1x24 jam\n```\n\nField yang kosong boleh dilewati. Kirim pesan berikutnya dengan format di atas.",
      { parse_mode: "Markdown" }
    );
  });

  // ---------------------------------------------------------- text inputs (admin)
  bot.on("text", async (ctx) => {
    if (!isOwner(ctx)) return;
    // Owner replying to a forwarded DM → relay back to the buyer.
    const repliedTo = ctx.message?.reply_to_message?.message_id;
    if (repliedTo) {
      const buyerChatId = state.getRelay(repliedTo);
      if (buyerChatId) {
        try {
          await ctx.telegram.sendMessage(buyerChatId, `💬 *Balasan owner:*\n\n${ctx.message.text}`, { parse_mode: "Markdown" });
          await ctx.reply("✅ Balasan diteruskan ke pembeli/member.");
        } catch (e) {
          await ctx.reply(`Gagal meneruskan balasan: ${e.message}`);
        }
        return;
      }
    }
    const pending = state.getPendingText(ctx.chat.id);
    if (!pending) return;
    state.clearPendingText(ctx.chat.id);
    const text = (ctx.message.text || "").trim();

    if (pending.kind === "reject_reason") {
      try {
        const res = await api.rejectOrder(pending.orderId, text || "Ditolak admin");
        await ctx.telegram.sendMessage(
          res.order.buyerTelegramId,
          `❌ Order \`${res.order.id.slice(0, 8)}\` ditolak admin.\n\nAlasan: ${text || "Ditolak admin"}\n\nSilakan hubungi owner kalau ada pertanyaan.`,
          { parse_mode: "Markdown" }
        ).catch(() => {});
        await ctx.reply(`Order \`${res.order.id.slice(0, 8)}\` ditolak dan pembeli sudah diberitahu.`, { parse_mode: "Markdown" });
      } catch (e) {
        await ctx.reply(`Gagal menolak order: ${e.message}`);
      }
      return;
    }

    if (pending.kind === "price") {
      const digits = text.replace(/[^0-9]/g, "");
      const price = digits ? parseInt(digits, 10) : NaN;
      if (!Number.isFinite(price) || price < 0) {
        await ctx.reply("Harga tidak valid — kirim angka saja, contoh: 150000.");
        return;
      }
      try {
        const updated = await api.updateAdminPackage(pending.packageId, { price });
        await ctx.reply(`✅ Harga paket *${updated.package.name}* diubah menjadi ${fmtIdr(updated.package.price)}.`, { parse_mode: "Markdown" });
      } catch (e) {
        await ctx.reply(`Gagal mengubah harga: ${e.message}`);
      }
      return;
    }

    // RPM inputs: a number 1–10000, or 0/empty to clear the override
    // (key/package inherit). Global RPM has no "clear" — it must be a number.
    const parseRpmText = (t) => {
      const trimmed = t.trim();
      if (trimmed === "" || trimmed === "0") return { ok: true, value: null };
      const digits = trimmed.replace(/[^0-9]/g, "");
      const n = digits ? parseInt(digits, 10) : NaN;
      if (!Number.isFinite(n) || n < 1 || n > 10000) return { ok: false };
      return { ok: true, value: n };
    };

    if (pending.kind === "key_rpm") {
      const parsed = parseRpmText(text);
      if (!parsed.ok) {
        await ctx.reply("RPM tidak valid — kirim angka 1–10000, atau 0 untuk ikut default.");
        return;
      }
      try {
        const res = await api.setKeyRpm(pending.keyId, parsed.value);
        await ctx.reply(parsed.value === null
          ? `✅ Override RPM kunci *${res.key.name || res.key.id.slice(0, 8)}* dihapus — kunci ikut paket/global.`
          : `✅ RPM kunci *${res.key.name || res.key.id.slice(0, 8)}* diubah menjadi ${parsed.value}/menit.`, { parse_mode: "Markdown" });
      } catch (e) {
        await ctx.reply(`Gagal mengubah RPM kunci: ${e.message}`);
      }
      return;
    }

    if (pending.kind === "package_rpm") {
      const parsed = parseRpmText(text);
      if (!parsed.ok) {
        await ctx.reply("RPM tidak valid — kirim angka 1–10000, atau 0 untuk ikut default.");
        return;
      }
      try {
        const res = await api.updateAdminPackage(pending.packageId, { rpmLimit: parsed.value });
        await ctx.reply(parsed.value === null
          ? `✅ RPM default paket *${res.package.name}* dihapus — trial ikut 20, berbayar ikut global.`
          : `✅ RPM default paket *${res.package.name}* diubah menjadi ${parsed.value}/menit.`, { parse_mode: "Markdown" });
      } catch (e) {
        await ctx.reply(`Gagal mengubah RPM paket: ${e.message}`);
      }
      return;
    }

    if (pending.kind === "global_rpm") {
      const parsed = parseRpmText(text);
      if (!parsed.ok || parsed.value === null) {
        await ctx.reply("RPM global tidak valid — kirim angka 1–10000 (tidak ada unlimited).");
        return;
      }
      try {
        const res = await api.setGlobalRpm(parsed.value);
        await ctx.reply(`✅ RPM global diubah menjadi ${res.defaultRpmLimit}/menit.`, { parse_mode: "Markdown" });
      } catch (e) {
        await ctx.reply(`Gagal mengubah RPM global: ${e.message}`);
      }
      return;
    }

    if (pending.kind === "payment") {
      const parsed = {};
      for (const line of text.split("\n")) {
        const m = line.match(/^\s*(Bank|Rek|Nama|Ewallet|Nomor|Catatan)\s*:\s*(.+?)\s*$/i);
        if (!m) continue;
        const key = m[1].toLowerCase();
        const value = m[2].trim();
        if (key === "bank") parsed.bankName = value;
        if (key === "rek") parsed.accountNumber = value;
        if (key === "nama") parsed.accountName = value;
        if (key === "ewallet") parsed.ewalletName = value;
        if (key === "nomor") parsed.ewalletNumber = value;
        if (key === "catatan") parsed.notes = value;
      }
      if (!Object.keys(parsed).length) {
        await ctx.reply("Format tidak dikenali — kirim lagi dengan format:\nBank: ...\nRek: ...\nNama: ...\nEwallet: ...\nNomor: ...\nCatatan: ...");
        return;
      }
      try {
        const res = await api.updatePayment(parsed);
        await ctx.reply(`✅ Detail pembayaran disimpan.\n\n${renderPaymentDetails(res.payment)}`, { parse_mode: "Markdown" });
      } catch (e) {
        await ctx.reply(`Gagal menyimpan pembayaran: ${e.message}`);
      }
    }
  });
}
