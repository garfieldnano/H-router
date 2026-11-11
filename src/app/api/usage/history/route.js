import { NextResponse } from "next/server";
import { getUsageStats, getMemberUsageStats, sanitizeUsageStatsForBrowser } from "@/lib/usageDb";
import { getApiKeysByMemberId } from "@/lib/localDb";
import { getRequestMemberSession } from "@/lib/auth/memberAuth";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d", "all"]);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";
    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    // Members get ONLY their own usage (rows for keys with
    // apiKeys.memberId = session.memberId), computed from raw history.
    const member = await getRequestMemberSession();
    if (member) {
      const ownKeys = await getApiKeysByMemberId(member.memberId);
      const stats = await getMemberUsageStats(ownKeys.map((k) => k.key), period);
      return NextResponse.json(stats);
    }

    // Full keys must never reach the browser (G7 — same as /api/usage/stats).
    const stats = sanitizeUsageStatsForBrowser(await getUsageStats(period));
    return NextResponse.json(stats);
  } catch (error) {
    console.error("Error fetching usage stats:", error);
    return NextResponse.json({ error: "Failed to fetch usage stats" }, { status: 500 });
  }
}
