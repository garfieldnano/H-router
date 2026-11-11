import { NextResponse } from "next/server";
import { getRecentLogs } from "@/lib/usageDb";
import { getRequestMemberSession } from "@/lib/auth/memberAuth";
import { getApiKeysByMemberId } from "@/lib/localDb";

export async function GET() {
  try {
    // Members see ONLY their own request log lines (usageHistory rows
    // driven by their own keys).
    const member = await getRequestMemberSession();
    const ownKeyValues = member
      ? (await getApiKeysByMemberId(member.memberId)).map((k) => k.key)
      : null;
    const logs = await getRecentLogs(200, ownKeyValues);
    return NextResponse.json(logs);
  } catch (error) {
    console.error("[API ERROR] /api/usage/logs failed:", error);
    console.error("[API ERROR] Stack:", error?.stack);
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}
