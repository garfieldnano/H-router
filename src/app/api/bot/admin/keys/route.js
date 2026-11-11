import { NextResponse } from "next/server";
import { requireBotService } from "@/lib/bot/serviceAuth";
import { getApiKeys, getMembers } from "@/lib/localDb";
import { maskApiKey } from "@/shared/utils/apiKey";
import { getKeyRateStatus } from "@/sse/services/keyRateLimit.js";

export const dynamic = "force-dynamic";

// GET /api/bot/admin/keys — all keys, masked, with their member name + RPM.
export async function GET(request) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const [keys, members] = await Promise.all([getApiKeys(), getMembers()]);
    const memberName = new Map(members.map((m) => [m.id, m.name || m.email]));
    const withRate = await Promise.all(keys.map(async (k) => {
      const rate = await getKeyRateStatus(k.id).catch(() => null);
      return {
        id: k.id, name: k.name, keyMasked: maskApiKey(k.key),
        memberId: k.memberId || null, memberName: k.memberId ? memberName.get(k.memberId) || null : null,
        isActive: k.isActive, createdAt: k.createdAt, expiresAt: k.expiresAt || null,
        rpmLimit: k.rpmLimit ?? null, packageId: k.packageId || null,
        rate: rate
          ? { limit: rate.limit, source: rate.source, packageName: rate.packageName, used: rate.used, remaining: rate.remaining }
          : null,
      };
    }));
    return NextResponse.json({ keys: withRate });
  } catch (error) {
    console.log("Error fetching bot admin keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}
