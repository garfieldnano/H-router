import { NextResponse } from "next/server";
import { requireBotService } from "@/lib/bot/serviceAuth";
import { getCompensations, getIncidentById } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// GET /api/bot/admin/compensations — all granted compensations, newest
// first. Each row carries its incident's startedAt + duration for display.
export async function GET(request) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") || 100);
    const compensations = await getCompensations({ limit });
    const withIncident = await Promise.all(compensations.map(async (c) => {
      const incident = await getIncidentById(c.incidentId).catch(() => null);
      return {
        ...c,
        incidentStartedAt: incident?.startedAt || null,
        incidentDurationMinutes: incident?.durationMinutes ?? null,
        incidentStatus: incident?.status || null,
      };
    }));
    return NextResponse.json({ compensations: withIncident });
  } catch (error) {
    console.log("Error listing compensations for bot:", error);
    return NextResponse.json({ error: "Failed to list compensations" }, { status: 500 });
  }
}
