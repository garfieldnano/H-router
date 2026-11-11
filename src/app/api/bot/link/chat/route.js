import { NextResponse } from "next/server";
import { requireBotService } from "@/lib/bot/serviceAuth";
import { linkChat, getMemberById } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// POST /api/bot/link/chat — link a Telegram chat to a member directly.
// Used by the bot after a buy/trial auto-creates a member (no link code
// involved — the order/claim itself proves the association).
// Body: { telegramId, memberId, username, firstName }.
export async function POST(request) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const { telegramId, memberId, username, firstName } = body || {};
    if (!telegramId || !memberId) {
      return NextResponse.json({ error: "telegramId dan memberId diperlukan" }, { status: 400 });
    }
    const member = await getMemberById(memberId);
    if (!member) return NextResponse.json({ error: "Member tidak ditemukan" }, { status: 404 });
    const chat = await linkChat({ chatId: telegramId, memberId, username, firstName });
    return NextResponse.json({ ok: true, chat });
  } catch (error) {
    console.log("Error linking chat for bot:", error);
    return NextResponse.json({ error: "Failed to link chat" }, { status: 500 });
  }
}
