import { NextResponse } from "next/server";
import { requireBotService } from "@/lib/bot/serviceAuth";
import { rejectOrder } from "@/lib/bot/orderService";

export const dynamic = "force-dynamic";

// POST /api/bot/orders/[id]/reject — admin rejects an order.
// Body: { note } (reason shown to the buyer).
export async function POST(request, { params }) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const result = await rejectOrder(id, { note: body?.note });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status || 400 });
    }
    return NextResponse.json({ order: result.order });
  } catch (error) {
    console.log("Error rejecting order for bot:", error);
    return NextResponse.json({ error: "Failed to reject order" }, { status: 500 });
  }
}
