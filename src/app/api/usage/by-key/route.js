import { NextResponse } from "next/server";
import { getUsageStats } from "@/lib/usageDb";
import { getApiKeys, getMembers } from "@/lib/localDb";
import { getRequestMemberSession } from "@/lib/auth/memberAuth";
import { aggregateUsageByKey } from "@/shared/utils/keyUsage.js";

export const dynamic = "force-dynamic";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d", "all"]);

// Admin-only: the dashboard guard blocks member sessions from
// /api/usage/by-key, this check is defense in depth.
async function forbidMember() {
  if (await getRequestMemberSession()) {
    return NextResponse.json({ error: "Forbidden: admin only" }, { status: 403 });
  }
  return null;
}

// GET /api/usage/by-key?period=7d — usage aggregated per API key
// (plan G7, Pemakaian Kunci). One row per key (keys with no usage in the
// period get a zero row), each with a per-model breakdown. Built on the
// existing usageHistory aggregation — no new table.
export async function GET(request) {
  try {
    const denied = await forbidMember();
    if (denied) return denied;

    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";
    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const [stats, keys, members] = await Promise.all([
      getUsageStats(period),
      getApiKeys(),
      getMembers(),
    ]);
    const rows = aggregateUsageByKey(stats, keys, members);
    const totals = rows.reduce(
      (acc, r) => {
        acc.requests += r.requests;
        acc.promptTokens += r.promptTokens;
        acc.completionTokens += r.completionTokens;
        acc.cost += r.cost;
        return acc;
      },
      { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 }
    );
    return NextResponse.json({ period, rows, totals });
  } catch (error) {
    console.error("[API] Failed to fetch per-key usage:", error);
    return NextResponse.json({ error: "Failed to fetch per-key usage" }, { status: 500 });
  }
}
