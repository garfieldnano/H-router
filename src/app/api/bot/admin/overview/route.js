import { NextResponse } from "next/server";
import { requireBotService } from "@/lib/bot/serviceAuth";
import { getMembers, getApiKeys, countOrders } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// GET /api/bot/admin/overview — counts for the bot admin home screen.
export async function GET(request) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const [members, keys, pendingOrders, totalOrders] = await Promise.all([
      getMembers(), getApiKeys(), countOrders({ status: "pending_confirm" }), countOrders(),
    ]);
    return NextResponse.json({
      members: members.length,
      activeMembers: members.filter((m) => m.isActive).length,
      apiKeys: keys.length,
      activeKeys: keys.filter((k) => k.isActive).length,
      pendingOrders,
      totalOrders,
    });
  } catch (error) {
    console.log("Error fetching bot admin overview:", error);
    return NextResponse.json({ error: "Failed to fetch overview" }, { status: 500 });
  }
}
