import { NextResponse } from "next/server";
import { requireBotService } from "@/lib/bot/serviceAuth";
import { getOrderById } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// GET /api/bot/orders/[id] — single order (bot admin view).
export async function GET(request, { params }) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const order = await getOrderById(id);
    if (!order) return NextResponse.json({ error: "Order tidak ditemukan" }, { status: 404 });
    return NextResponse.json({ order });
  } catch (error) {
    console.log("Error fetching order for bot:", error);
    return NextResponse.json({ error: "Failed to fetch order" }, { status: 500 });
  }
}
