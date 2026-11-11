import { NextResponse } from "next/server";
import { requireBotService } from "@/lib/bot/serviceAuth";
import { sweepExpiredTrialKeys } from "@/lib/bot/orderService";

export const dynamic = "force-dynamic";

// POST /api/bot/admin/sweep-trials — deactivate expired trial keys.
// Called hourly by the bot scheduler; validateApiKey() already rejects
// expired keys, this is hygiene + the list the bot uses to notify members.
export async function POST(request) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const deactivated = await sweepExpiredTrialKeys();
    return NextResponse.json({ deactivated, count: deactivated.length });
  } catch (error) {
    console.log("Error sweeping expired trial keys:", error);
    return NextResponse.json({ error: "Failed to sweep trials" }, { status: 500 });
  }
}
