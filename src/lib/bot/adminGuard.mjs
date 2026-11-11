// Admin guard — only the owner chat ID may see or use the admin panel.
// ownerChatId comes from env (TELEGRAM_OWNER_CHAT_ID, takes precedence) or
// from settings.telegramBot.ownerChatId. Everyone else gets NOTHING: no
// admin menu, no hint it exists.

export function normalizeChatId(value) {
  if (value === undefined || value === null || value === "") return null;
  return String(value).trim();
}

export function isOwnerChatId(chatId, ownerChatId) {
  const a = normalizeChatId(chatId);
  const b = normalizeChatId(ownerChatId);
  if (!a || !b) return false;
  return a === b;
}
