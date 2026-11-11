import { NextResponse } from "next/server";
import { getChartData, getMemberChartData } from "@/lib/usageDb";
import { getRequestMemberSession } from "@/lib/auth/memberAuth";
import { getApiKeysByMemberId } from "@/lib/localDb";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d", "all"]);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    // Members get chart buckets computed from their own usageHistory rows
    // only (the daily rollup table is global, no apiKey column).
    const member = await getRequestMemberSession();
    if (member) {
      const ownKeys = await getApiKeysByMemberId(member.memberId);
      const data = await getMemberChartData(ownKeys.map((k) => k.key), period);
      return NextResponse.json(data);
    }

    const data = await getChartData(period);
    return NextResponse.json(data);
  } catch (error) {
    console.error("[API] Failed to get chart data:", error);
    return NextResponse.json({ error: "Failed to fetch chart data" }, { status: 500 });
  }
}
