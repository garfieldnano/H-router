import { NextResponse } from "next/server";
import { getRequestMemberSession } from "@/lib/auth/memberAuth";
import { grantCompensation } from "@/lib/bot/compensationService";

export const dynamic = "force-dynamic";

// Admin-only: the middleware blocks member sessions from /api/incidents*,
// this check is defense in depth.
async function forbidMember() {
  if (await getRequestMemberSession()) {
    return NextResponse.json({ error: "Forbidden: admin only" }, { status: 403 });
  }
  return null;
}

// POST /api/incidents/[id]/grant — manual compensation grant (admin only).
// Body: { keyId, tierHours? } — tierHours omitted = derived from the
// incident's duration. The service refuses double-grants, keys without
// expiry, and inactive keys with a clear error (no silent no-op).
export async function POST(request, { params }) {
  try {
    const denied = await forbidMember();
    if (denied) return denied;
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const result = await grantCompensation({
      incidentId: id,
      keyId: body.keyId,
      tierHours: body.tierHours ?? null,
      grantedBy: "admin",
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status || 400 });
    }
    return NextResponse.json({
      compensation: result.compensation,
      key: result.key,
      incident: result.incident,
      derivedTierHours: result.derivedTier,
      durationMinutes: result.durationMinutes,
      notifyChatId: result.notifyChatId || null,
    });
  } catch (error) {
    console.log("Error granting compensation:", error);
    return NextResponse.json({ error: "Failed to grant compensation" }, { status: 500 });
  }
}
