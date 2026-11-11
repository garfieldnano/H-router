// Order status machine — single source of truth for allowed transitions.
// Statuses: pending_payment -> pending_confirm -> confirmed | rejected
// The repo (ordersRepo) only persists; every move must pass through here.

export const ORDER_STATUSES = ["pending_payment", "pending_confirm", "confirmed", "rejected"];

const ALLOWED = {
  pending_payment: ["pending_confirm"], // buyer uploads proof (or cancels -> rejected)
  pending_confirm: ["confirmed", "rejected"],
  confirmed: [],
  rejected: [],
};

export function canTransition(from, to) {
  if (!ORDER_STATUSES.includes(from) || !ORDER_STATUSES.includes(to)) return false;
  return (ALLOWED[from] || []).includes(to);
}

/** Next statuses an order may move to (for admin keyboards). */
export function nextStatuses(status) {
  return [...(ALLOWED[status] || [])];
}

export const ORDER_STATUS_LABEL = {
  pending_payment: "⏳ Menunggu pembayaran",
  pending_confirm: "🔎 Menunggu konfirmasi admin",
  confirmed: "✅ Terkonfirmasi",
  rejected: "❌ Ditolak",
};

export function orderStatusLabel(status) {
  return ORDER_STATUS_LABEL[status] || status;
}

// ------------------------------------------------------- buy-flow state machine
// The bot keeps per-chat buy state in memory (no DB row until the order is
// created). States: idle -> package_chosen -> proof_pending -> done.

export const BUY_STATES = ["idle", "package_chosen", "proof_pending", "done"];

const BUY_ALLOWED = {
  idle: ["package_chosen"],
  package_chosen: ["proof_pending", "idle"], // idle = user cancels / picks another
  proof_pending: ["done", "idle"],
  done: ["idle"],
};

export function buyCanTransition(from, to) {
  return (BUY_ALLOWED[from] || []).includes(to);
}
