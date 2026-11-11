// Payment details (manual transfer) — read from settings, never hardcoded.
// Empty until the admin sets them; the bot must show a clear "not set,
// contact owner" state and NEVER invent account numbers.

export const EMPTY_PAYMENT = {
  bankName: "",
  accountNumber: "",
  accountName: "",
  ewalletName: "",
  ewalletNumber: "",
  notes: "",
};

export function getTelegramBotSettings(settings) {
  const raw = settings?.telegramBot || {};
  return {
    ownerChatId: raw.ownerChatId || "",
    botUsername: raw.botUsername || "",
    payment: { ...EMPTY_PAYMENT, ...(raw.payment || {}) },
  };
}

/** True when at least one payment channel is fully configured. */
export function isPaymentConfigured(payment) {
  const p = payment || {};
  const bankOk = Boolean((p.bankName || "").trim() && (p.accountNumber || "").trim() && (p.accountName || "").trim());
  const walletOk = Boolean((p.ewalletName || "").trim() && (p.ewalletNumber || "").trim());
  return bankOk || walletOk;
}

export function renderPaymentDetails(payment) {
  if (!isPaymentConfigured(payment)) {
    return "⚠️ *Detail pembayaran belum diatur admin.*\nSilakan hubungi owner untuk info pembayaran.";
  }
  const lines = ["💳 *Pembayaran (transfer manual)*", ""];
  const p = payment;
  if ((p.bankName || "").trim() && (p.accountNumber || "").trim()) {
    lines.push(`Bank: ${p.bankName}`);
    lines.push(`No. rekening: \`${p.accountNumber.trim()}\``);
    if ((p.accountName || "").trim()) lines.push(`Atas nama: ${p.accountName.trim()}`);
    lines.push("");
  }
  if ((p.ewalletName || "").trim() && (p.ewalletNumber || "").trim()) {
    lines.push(`E-wallet: ${p.ewalletName}`);
    lines.push(`Nomor: \`${p.ewalletNumber.trim()}\``);
    lines.push("");
  }
  if ((p.notes || "").trim()) lines.push(`ℹ️ ${p.notes.trim()}`);
  lines.push("Setelah transfer, kirim *foto bukti* di chat ini.");
  return lines.join("\n");
}
