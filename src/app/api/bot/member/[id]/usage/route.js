import { NextResponse } from "next/server";
import { requireBotService } from "@/lib/bot/serviceAuth";
import { getMemberById, getApiKeysByMemberId, getMemberUsageStats } from "@/lib/localDb";

export const dynamic = "force-dynamic";

const PERIODS = ["today", "24h", "7d", "30d", "all"];

// GET /api/bot/member/[id]/usage?period=today — member's own usage stats
// (same shape as the web member dashboard's /api/usage/history).
export async function GET(request, { params }) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const member = await getMemberById(id);
    if (!member) return NextResponse.json({ error: "Member tidak ditemukan" }, { status: 404 });
    const period = request.nextUrl.searchParams.get("period") || "today";
    if (!PERIODS.includes(period)) {
      return NextResponse.json({ error: "period tidak valid" }, { status: 400 });
    }
    // getMemberUsageStats expects API key VALUES (array), not a member id.
    const ownKeys = await getApiKeysByMemberId(id);
    const stats = await getMemberUsageStats(ownKeys.map((k) => k.key), period);
    return NextResponse.json({ member: { id: member.id, name: member.name }, period, ...stats });
  } catch (error) {
    console.log("Error fetching member usage for bot:", error);
    return NextResponse.json({ error: "Failed to fetch member usage" }, { status: 500 });
  }
}
