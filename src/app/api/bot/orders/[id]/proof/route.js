import { NextResponse } from "next/server";
import { requireBotService } from "@/lib/bot/serviceAuth";
import { getOrderById, updateOrder } from "@/lib/localDb";
import { canTransition } from "@/lib/bot/orderFlow";

export const dynamic = "force-dynamic";

// POST /api/bot/orders/[id]/proof — buyer uploads a payment proof photo.
// Body: { fileId }. pending_payment -> pending_confirm.
export async function POST(request, { params }) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = await request.json();
    const fileId = body?.fileId;
    if (!fileId) return NextResponse.json({ error: "fileId bukti pembayaran diperlukan" }, { status: 400 });
    const order = await getOrderById(id);
    if (!order) return NextResponse.json({ error: "Order tidak ditemukan" }, { status: 404 });
    if (!canTransition(order.status, "pending_confirm")) {
      return NextResponse.json({ error: `Order sudah ${order.status}, tidak bisa kirim bukti` }, { status: 409 });
    }
    const updated = await updateOrder(id, { status: "pending_confirm", proofFileId: fileId });
    return NextResponse.json({ order: updated });
  } catch (error) {
    console.log("Error uploading order proof for bot:", error);
    return NextResponse.json({ error: "Failed to upload proof" }, { status: 500 });
  }
}
