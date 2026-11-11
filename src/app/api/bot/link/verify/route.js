import { NextResponse } from "next/server";
import { requireBotService } from "@/lib/bot/serviceAuth";
import { consumeLinkCode, linkChat, getMemberById } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// POST /api/bot/link/verify — bot consumed a /start <code>.
// Body: { code, telegramId, username, firstName }. Links the chat to the
// member. Code is single-use; consumed (or expired) codes fail.
export async function POST(request) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const { code, telegramId, username, firstName } = body || {};
    if (!code || !telegramId) {
      return NextResponse.json({ error: "code dan telegramId diperlukan" }, { status: 400 });
    }
    const consumed = await consumeLinkCode(code);
    if (!consumed) {
      return NextResponse.json({ error: "Kode tidak valid, sudah dipakai, atau sudah kedaluwarsa" }, { status: 400 });
    }
    const member = await getMemberById(consumed.memberId);
    if (!member) {
      return NextResponse.json({ error: "Member tidak ditemukan" }, { status: 404 });
    }
    const chat = await linkChat({ chatId: telegramId, memberId: member.id, username, firstName });
    return NextResponse.json({
      ok: true,
      member: { id: member.id, name: member.name, email: member.email },
      chat,
    });
  } catch (error) {
    console.log("Error verifying telegram link code:", error);
    return NextResponse.json({ error: "Failed to verify link code" }, { status: 500 });
  }
}
