import { NextResponse } from "next/server";
import { requireBotService } from "@/lib/bot/serviceAuth";
import { getMemberById, getApiKeysByMemberId, getUsageRowsBetween } from "@/lib/localDb";
import { getWibDayBounds, buildMemberDailyReport } from "@/lib/bot/digest";

export const dynamic = "force-dynamic";

// GET /api/bot/member/[id]/daily — member's own usage TODAY (WIB day),
// mirroring the web member dashboard's "Hari ini" filter. Scoped to the
// member's own keys only; day boundaries are Asia/Jakarta.
export async function GET(request, { params }) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const member = await getMemberById(id);
    if (!member) return NextResponse.json({ error: "Member tidak ditemukan" }, { status: 404 });
    const keys = await getApiKeysByMemberId(id);
    const bounds = getWibDayBounds(new Date());
    const rows = await getUsageRowsBetween(bounds.start, bounds.end, {
      apiKeys: keys.map((k) => k.key),
    });
    const report = buildMemberDailyReport(rows, { label: bounds.label });
    return NextResponse.json({ member: { id: member.id, name: member.name }, ...report });
  } catch (error) {
    console.log("Error fetching member daily report for bot:", error);
    return NextResponse.json({ error: "Failed to fetch daily report" }, { status: 500 });
  }
}
