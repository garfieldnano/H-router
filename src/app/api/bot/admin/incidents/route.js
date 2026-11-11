import { NextResponse } from "next/server";
import { requireBotService } from "@/lib/bot/serviceAuth";
import { getIncidents, countCompensations } from "@/lib/localDb";
import { tierForOutageMinutes, incidentDurationMinutes } from "@/lib/bot/compensation";

export const dynamic = "force-dynamic";

// GET /api/bot/admin/incidents — list incidents (open first), each with
// its duration, derived compensation tier, and granted-compensation count.
export async function GET(request) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || undefined;
    const limit = Number(searchParams.get("limit") || 50);
    const incidents = await getIncidents({ status, limit });
    const withMeta = await Promise.all(incidents.map(async (i) => {
      const duration = incidentDurationMinutes(i);
      return {
        ...i,
        durationMinutes: i.durationMinutes ?? duration,
        derivedTierHours: tierForOutageMinutes(duration),
        compensationsGranted: await countCompensations({ incidentId: i.id }),
      };
    }));
    // Open incidents first, then most recent.
    withMeta.sort((a, b) => (a.status === b.status ? 0 : a.status === "open" ? -1 : 1));
    return NextResponse.json({ incidents: withMeta });
  } catch (error) {
    console.log("Error listing incidents for bot:", error);
    return NextResponse.json({ error: "Failed to list incidents" }, { status: 500 });
  }
}
