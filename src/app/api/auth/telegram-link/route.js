import { NextResponse } from "next/server";
import { getRequestMemberSession } from "@/lib/auth/memberAuth";
import { createLinkCode, LINK_CODE_TTL_MS } from "@/lib/localDb";
import { getSettings } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// POST /api/auth/telegram-link — member requests a one-time Telegram link code.
// Member session required. Returns { code, expiresInSec, botUsername }.
// The member opens t.me/<botUsername>?start=<code> (or types /start <code>)
// and the bot links that chat to this member. Code is single-use, 10 min.
export async function POST() {
  try {
    const session = await getRequestMemberSession();
    if (!session?.memberId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const link = await createLinkCode(session.memberId);
    const settings = await getSettings();
    const botUsername = settings?.telegramBot?.botUsername || process.env.TELEGRAM_BOT_USERNAME || "";
    return NextResponse.json({
      code: link.code,
      expiresInSec: Math.floor(LINK_CODE_TTL_MS / 1000),
      expiresAt: link.expiresAt,
      botUsername,
    });
  } catch (error) {
    console.log("Error creating telegram link code:", error);
    return NextResponse.json({ error: "Failed to create link code" }, { status: 500 });
  }
}
