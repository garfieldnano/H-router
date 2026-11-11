import { NextResponse } from "next/server";
import { requireBotService } from "@/lib/bot/serviceAuth";
import { claimTrial } from "@/lib/bot/orderService";

export const dynamic = "force-dynamic";

// POST /api/bot/trial/claim — claim the free trial (once per Telegram user).
// Body: { telegramId, username, firstName }. No payment, no admin confirm:
// the key is auto-issued with a 1-day expiry (package durationDays).
export async function POST(request) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const { telegramId, username, firstName } = body || {};
    if (!telegramId) {
      return NextResponse.json({ error: "telegramId diperlukan" }, { status: 400 });
    }
    const result = await claimTrial({ telegramId, username, firstName });
    if (!result.ok) {
      return NextResponse.json({ error: result.error, reason: result.reason }, { status: result.status || 400 });
    }
    return NextResponse.json({
      member: { id: result.member.id, name: result.member.name },
      apiKey: {
        id: result.apiKey.id,
        key: result.apiKey.key,
        name: result.apiKey.name,
        expiresAt: result.apiKey.expiresAt || null,
      },
      package: result.pkg,
      claim: result.claim,
    }, { status: 201 });
  } catch (error) {
    console.log("Error claiming trial for bot:", error);
    return NextResponse.json({ error: "Failed to claim trial" }, { status: 500 });
  }
}
