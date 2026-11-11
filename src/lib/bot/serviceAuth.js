// Internal bot API auth — the Telegram bot process talks to the server over
// HTTP (localhost) with a shared service secret, NOT direct DB access, so
// member scoping stays enforced server-side. The secret lives ONLY in env
// (HROUTER_BOT_SECRET) — never in code, never in settings, never logged.
// The bot process and the Next.js server must share the same value.

import crypto from "node:crypto";
import { NextResponse } from "next/server";

export function getBotServiceSecret() {
  return process.env.HROUTER_BOT_SECRET || "";
}

/** Constant-time secret check. Returns a NextResponse on failure, else null. */
export function requireBotService(request) {
  const secret = getBotServiceSecret();
  if (!secret) {
    return NextResponse.json(
      { error: "Bot internal API belum dikonfigurasi (HROUTER_BOT_SECRET belum diset di server)" },
      { status: 503 }
    );
  }
  const provided = request.headers.get("x-hrouter-bot-secret") || "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
