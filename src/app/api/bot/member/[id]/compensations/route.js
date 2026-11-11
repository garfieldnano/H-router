import { NextResponse } from "next/server";
import { requireBotService } from "@/lib/bot/serviceAuth";
import { getMemberById, getCompensationsByMemberId, getIncidentById } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// GET /api/bot/member/[id]/compensations — the member's OWN compensation
// history (read-only). Scoped server-side to the member's keys via
// memberId; the bot only ever asks for the linked member.
export async function GET(request, { params }) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const member = await getMemberById(id);
    if (!member) return NextResponse.json({ error: "Member tidak ditemukan" }, { status: 404 });
    const compensations = await getCompensationsByMemberId(id);
    const withIncident = await Promise.all(compensations.map(async (c) => {
      const incident = await getIncidentById(c.incidentId).catch(() => null);
      return {
        ...c,
        incidentStartedAt: incident?.startedAt || null,
        incidentDurationMinutes: incident?.durationMinutes ?? null,
      };
    }));
    return NextResponse.json({ member: { id: member.id, name: member.name }, compensations: withIncident });
  } catch (error) {
    console.log("Error fetching member compensations for bot:", error);
    return NextResponse.json({ error: "Failed to fetch compensations" }, { status: 500 });
  }
}
