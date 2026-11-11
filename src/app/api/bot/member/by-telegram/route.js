import { NextResponse } from "next/server";
import { requireBotService } from "@/lib/bot/serviceAuth";
import { getChatById, getMemberById } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// GET /api/bot/member/by-telegram?telegramId=... — resolve a chat to its member.
export async function GET(request) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const telegramId = request.nextUrl.searchParams.get("telegramId");
    if (!telegramId) {
      return NextResponse.json({ error: "telegramId diperlukan" }, { status: 400 });
    }
    const chat = await getChatById(telegramId);
    if (!chat?.memberId) return NextResponse.json({ member: null, chat: chat || null });
    const member = await getMemberById(chat.memberId);
    if (!member) return NextResponse.json({ member: null, chat });
    return NextResponse.json({ member: { id: member.id, name: member.name, email: member.email, isActive: member.isActive }, chat });
  } catch (error) {
    console.log("Error resolving member by telegram:", error);
    return NextResponse.json({ error: "Failed to resolve member" }, { status: 500 });
  }
}
