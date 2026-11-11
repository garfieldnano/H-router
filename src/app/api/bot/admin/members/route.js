import { NextResponse } from "next/server";
import { requireBotService } from "@/lib/bot/serviceAuth";
import { getMembers, getApiKeys } from "@/lib/localDb";
import { maskApiKey } from "@/shared/utils/apiKey";

export const dynamic = "force-dynamic";

// GET /api/bot/admin/members — member list with their (masked) keys.
export async function GET(request) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const [members, keys] = await Promise.all([getMembers(), getApiKeys()]);
    const byMember = new Map();
    for (const k of keys) {
      if (!k.memberId) continue;
      if (!byMember.has(k.memberId)) byMember.set(k.memberId, []);
      byMember.get(k.memberId).push({
        id: k.id, name: k.name, keyMasked: maskApiKey(k.key),
        isActive: k.isActive, createdAt: k.createdAt, expiresAt: k.expiresAt || null,
      });
    }
    return NextResponse.json({
      members: members.map((m) => ({ ...m, keys: byMember.get(m.id) || [] })),
    });
  } catch (error) {
    console.log("Error fetching bot admin members:", error);
    return NextResponse.json({ error: "Failed to fetch members" }, { status: 500 });
  }
}
