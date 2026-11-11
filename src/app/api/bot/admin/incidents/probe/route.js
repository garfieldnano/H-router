import { NextResponse } from "next/server";
import { requireBotService } from "@/lib/bot/serviceAuth";
import { recordProbe } from "@/lib/bot/compensationService";

export const dynamic = "force-dynamic";

// POST /api/bot/admin/incidents/probe — the health prober's write side.
// Body: { status: 'up'|'down', reason?, reasonDetail?, firstFailedAt?, checkedAt? }
// The server opens/extends/closes the gateway incident row. An 'up' report
// first checks the recent request error rate — a reachable gateway that
// mostly errors is still down.
export async function POST(request) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({}));
    const result = await recordProbe(body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status || 400 });
    }
    return NextResponse.json({ action: result.action, incident: result.incident || null });
  } catch (error) {
    console.log("Error recording incident probe:", error);
    return NextResponse.json({ error: "Failed to record probe" }, { status: 500 });
  }
}
