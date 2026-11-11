import { NextResponse } from "next/server";
import { getIncidents, countCompensations } from "@/lib/localDb";
import { getRequestMemberSession } from "@/lib/auth/memberAuth";
import { tierForOutageMinutes, incidentDurationMinutes } from "@/lib/bot/compensation";

export const dynamic = "force-dynamic";

// Admin-only: the middleware blocks member sessions from /api/incidents*,
// this check is defense in depth.
async function forbidMember() {
  if (await getRequestMemberSession()) {
    return NextResponse.json({ error: "Forbidden: admin only" }, { status: 403 });
  }
  return null;
}

// GET /api/incidents — list incidents (open first), each with its duration,
// derived compensation tier, and granted-compensation count.
export async function GET(request) {
  try {
    const denied = await forbidMember();
    if (denied) return denied;
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || undefined;
    const incidents = await getIncidents({ status, limit: 100 });
    const withMeta = await Promise.all(incidents.map(async (i) => {
      const duration = incidentDurationMinutes(i);
      return {
        ...i,
        durationMinutes: i.durationMinutes ?? duration,
        derivedTierHours: tierForOutageMinutes(duration),
        compensationsGranted: await countCompensations({ incidentId: i.id }),
      };
    }));
    withMeta.sort((a, b) => (a.status === b.status ? 0 : a.status === "open" ? -1 : 1));
    return NextResponse.json({ incidents: withMeta });
  } catch (error) {
    console.log("Error fetching incidents:", error);
    return NextResponse.json({ error: "Failed to fetch incidents" }, { status: 500 });
  }
}
