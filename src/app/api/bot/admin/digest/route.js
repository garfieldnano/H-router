import { NextResponse } from "next/server";
import { requireBotService } from "@/lib/bot/serviceAuth";
import { getApiKeys, getMembers, getUsageRowsBetween } from "@/lib/localDb";
import { getWibDayBounds, getPreviousWibDayBounds, buildDailyDigest } from "@/lib/bot/digest";

export const dynamic = "force-dynamic";

// GET /api/bot/admin/digest?date=YYYY-MM-DD — admin daily digest data.
// No date = yesterday (WIB). The bot's 08:00 WIB scheduler calls this
// without a date; the admin can also request a specific day.
export async function GET(request) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const dateParam = request.nextUrl.searchParams.get("date");
    let bounds;
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      // Noon WIB on that date lands safely inside the requested WIB day.
      bounds = getWibDayBounds(new Date(`${dateParam}T12:00:00+07:00`));
    } else {
      bounds = getPreviousWibDayBounds(new Date());
    }
    const [keys, members] = await Promise.all([getApiKeys(), getMembers()]);
    const memberName = new Map(members.map((m) => [m.id, m.name || m.email]));
    const keyMeta = {};
    for (const k of keys) {
      if (!k.key) continue;
      keyMeta[k.key] = {
        memberId: k.memberId || null,
        memberName: k.memberId ? memberName.get(k.memberId) || "Member" : "Tanpa member",
        keyName: k.name || null,
      };
    }
    const rows = await getUsageRowsBetween(bounds.start, bounds.end);
    const digest = buildDailyDigest(rows, keyMeta, { label: bounds.label });
    return NextResponse.json({ ...digest, start: bounds.start, end: bounds.end });
  } catch (error) {
    console.log("Error building bot admin digest:", error);
    return NextResponse.json({ error: "Failed to build digest" }, { status: 500 });
  }
}
