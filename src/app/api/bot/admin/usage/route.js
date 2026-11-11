import { NextResponse } from "next/server";
import { requireBotService } from "@/lib/bot/serviceAuth";
import { getUsageStats } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// GET /api/bot/admin/usage?period=today — global usage stats for the admin panel.
export async function GET(request) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const period = request.nextUrl.searchParams.get("period") || "today";
    const stats = await getUsageStats(period);
    return NextResponse.json({ period, ...stats });
  } catch (error) {
    console.log("Error fetching admin usage for bot:", error);
    return NextResponse.json({ error: "Failed to fetch usage" }, { status: 500 });
  }
}
