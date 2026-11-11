import { NextResponse } from "next/server";
import { requireBotService } from "@/lib/bot/serviceAuth";
import { getMemberById, updateMember } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// POST /api/bot/admin/members/[id]/toggle — activate/deactivate a member.
export async function POST(request, { params }) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const member = await getMemberById(id);
    if (!member) return NextResponse.json({ error: "Member tidak ditemukan" }, { status: 404 });
    const updated = await updateMember(id, { isActive: !member.isActive });
    return NextResponse.json({ member: updated });
  } catch (error) {
    console.log("Error toggling member for bot:", error);
    return NextResponse.json({ error: "Failed to toggle member" }, { status: 500 });
  }
}
