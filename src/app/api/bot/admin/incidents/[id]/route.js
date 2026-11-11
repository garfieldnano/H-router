import { NextResponse } from "next/server";
import { requireBotService } from "@/lib/bot/serviceAuth";
import { getIncidentById, getCompensations } from "@/lib/localDb";
import { tierForOutageMinutes, incidentDurationMinutes } from "@/lib/bot/compensation";

export const dynamic = "force-dynamic";

// GET /api/bot/admin/incidents/[id] — one incident + its granted
// compensations + the tier derived from its duration.
export async function GET(request, { params }) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const incident = await getIncidentById(id);
    if (!incident) return NextResponse.json({ error: "Insiden tidak ditemukan" }, { status: 404 });
    const duration = incidentDurationMinutes(incident);
    const compensations = await getCompensations({ incidentId: id, limit: 200 });
    return NextResponse.json({
      incident: {
        ...incident,
        durationMinutes: incident.durationMinutes ?? duration,
        derivedTierHours: tierForOutageMinutes(duration),
      },
      compensations,
    });
  } catch (error) {
    console.log("Error fetching incident for bot:", error);
    return NextResponse.json({ error: "Failed to fetch incident" }, { status: 500 });
  }
}
