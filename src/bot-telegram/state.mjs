// In-memory per-chat session state. Nothing here is persisted —
// orders, claims, and links live in the server DB; this only tracks
// multi-step conversations inside Telegram (buy flow, DM, admin inputs).

export class BotState {
  constructor() {
    // chatId -> { state: 'package_chosen'|'proof_pending', orderId, packageId }
    this.buy = new Map();
    // chatId -> { kind: 'dm'|'reject_reason'|'price'|'payment', ... }
    this.pendingText = new Map();
    // forwarded message id (in the owner chat) -> buyer chat id
    this.relay = new Map();
    // chatId -> { incidentId, memberId?, keyId? } — multi-step grant flow
    this.grant = new Map();
  }

  setGrant(chatId, value) { this.grant.set(String(chatId), value); }
  getGrant(chatId) { return this.grant.get(String(chatId)) || null; }
  clearGrant(chatId) { this.grant.delete(String(chatId)); }

  setBuy(chatId, value) { this.buy.set(String(chatId), value); }
  getBuy(chatId) { return this.buy.get(String(chatId)) || null; }
  clearBuy(chatId) { this.buy.delete(String(chatId)); }

  setPendingText(chatId, value) { this.pendingText.set(String(chatId), value); }
  getPendingText(chatId) { return this.pendingText.get(String(chatId)) || null; }
  clearPendingText(chatId) { this.pendingText.delete(String(chatId)); }

  setRelay(forwardedMessageId, buyerChatId) { this.relay.set(String(forwardedMessageId), String(buyerChatId)); }
  getRelay(forwardedMessageId) { return this.relay.get(String(forwardedMessageId)) || null; }
}
