import { NextResponse } from "next/server";
import { requireBotService } from "@/lib/bot/serviceAuth";
import { getMemberById } from "@/lib/localDb";
import { getMemberKeysForBot } from "@/lib/bot/orderService";

export const dynamic = "force-dynamic";

// GET /api/bot/member/[id]/keys — member's own keys, MASKED (never raw).
// Full keys are only ever delivered at issuance (order confirm / trial).
export async function GET(request, { params }) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const member = await getMemberById(id);
    if (!member) return NextResponse.json({ error: "Member tidak ditemukan" }, { status: 404 });
    const keys = await getMemberKeysForBot(id);
    return NextResponse.json({ member: { id: member.id, name: member.name }, keys });
  } catch (error) {
    console.log("Error fetching member keys for bot:", error);
    return NextResponse.json({ error: "Failed to fetch member keys" }, { status: 500 });
  }
}
