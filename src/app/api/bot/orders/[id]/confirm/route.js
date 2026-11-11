import { NextResponse } from "next/server";
import { requireBotService } from "@/lib/bot/serviceAuth";
import { confirmOrder } from "@/lib/bot/orderService";

export const dynamic = "force-dynamic";

// POST /api/bot/orders/[id]/confirm — admin confirms a paid order.
// Issues a NEW h-router- key automatically (and auto-creates the member
// from the order if the buyer has none) and returns the FULL key — the bot
// delivers it to the buyer over Telegram. The key is never logged.
export async function POST(request, { params }) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const result = await confirmOrder(id, { note: body?.note });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status || 400 });
    }
    return NextResponse.json({
      order: result.order,
      member: { id: result.member.id, name: result.member.name },
      apiKey: {
        id: result.apiKey.id,
        key: result.apiKey.key,
        name: result.apiKey.name,
        expiresAt: result.apiKey.expiresAt || null,
      },
      package: result.pkg,
    });
  } catch (error) {
    console.log("Error confirming order for bot:", error);
    return NextResponse.json({ error: "Failed to confirm order" }, { status: 500 });
  }
}
