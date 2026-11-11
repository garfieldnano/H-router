import { NextResponse } from "next/server";
import { getCompensations, getCompensationsByMemberId, getIncidentById } from "@/lib/localDb";
import { getRequestMemberSession } from "@/lib/auth/memberAuth";

export const dynamic = "force-dynamic";

// GET /api/compensations — compensation history.
// Members see ONLY their own (scoped by the session memberId); admins see
// all. The dashboard guard also restricts members to this exact path.
export async function GET() {
  try {
    const member = await getRequestMemberSession();
    const compensations = member
      ? await getCompensationsByMemberId(member.memberId)
      : await getCompensations({ limit: 200 });
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
    console.log("Error fetching compensations:", error);
    return NextResponse.json({ error: "Failed to fetch compensations" }, { status: 500 });
  }
}
