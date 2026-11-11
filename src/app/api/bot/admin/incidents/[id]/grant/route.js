import { NextResponse } from "next/server";
import { requireBotService } from "@/lib/bot/serviceAuth";
import { grantCompensation } from "@/lib/bot/compensationService";

export const dynamic = "force-dynamic";

// POST /api/bot/admin/incidents/[id]/grant — manual compensation grant.
// Body: { keyId, tierHours? } — tierHours omitted = derived from the
// incident's duration. The service refuses double-grants, keys without
// expiry, and inactive keys with a clear error (no silent no-op).
export async function POST(request, { params }) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
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
    console.log("Error granting compensation from bot:", error);
    return NextResponse.json({ error: "Failed to grant compensation" }, { status: 500 });
  }
}
