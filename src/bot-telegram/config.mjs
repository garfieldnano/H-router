// Bot runtime config — all from env, nothing hardcoded.
// Required: TELEGRAM_BOT_TOKEN, HROUTER_BOT_SECRET.
// Optional: HROUTER_BASE_URL (default http://127.0.0.1:20127),
// TELEGRAM_OWNER_CHAT_ID (overrides settings), TELEGRAM_BOT_USERNAME,
// HROUTER_WEB_URL (links back to the web dashboard),
// HROUTER_BOT_DRY_RUN=1 (register handlers, verify config, exit — no polling).

export function loadConfig(env = process.env) {
  const token = (env.TELEGRAM_BOT_TOKEN || "").trim();
  const secret = (env.HROUTER_BOT_SECRET || "").trim();
  const baseUrl = (env.HROUTER_BASE_URL || "http://127.0.0.1:20127").replace(/\/+$/, "");
  const webUrl = (env.HROUTER_WEB_URL || baseUrl).replace(/\/+$/, "");
  const ownerChatId = (env.TELEGRAM_OWNER_CHAT_ID || "").trim();
  const botUsername = (env.TELEGRAM_BOT_USERNAME || "").trim();
  const dryRun = env.HROUTER_BOT_DRY_RUN === "1" || env.HROUTER_BOT_DRY_RUN === "true";
  // Health probe (§0d): how often to probe /api/health and how many
  // consecutive failures open an incident. Defaults: 60s / 3 failures.
  const probeIntervalMs = Math.max(5000, Number(env.HROUTER_HEALTH_PROBE_INTERVAL_MS) || 60000);
  const probeFailures = Math.max(1, Number(env.HROUTER_HEALTH_PROBE_FAILURES) || 3);
  const errors = [];
  if (!token) errors.push("TELEGRAM_BOT_TOKEN belum diset (minta token dari @BotFather)");
  if (!secret) errors.push("HROUTER_BOT_SECRET belum diset (harus sama dengan server)");
  return {
    token, secret, baseUrl, webUrl, ownerChatId, botUsername, dryRun,
    probeIntervalMs, probeFailures,
    ok: errors.length === 0,
    errors,
  };
}
