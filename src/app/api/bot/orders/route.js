import { NextResponse } from "next/server";
import { requireBotService } from "@/lib/bot/serviceAuth";
import { getPackageById, createOrder, getOrders } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// GET /api/bot/orders?status=&telegramId= — list orders (bot admin / buyer).
export async function GET(request) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const sp = request.nextUrl.searchParams;
    const orders = await getOrders({
      status: sp.get("status") || undefined,
      buyerTelegramId: sp.get("telegramId") || undefined,
      memberId: sp.get("memberId") || undefined,
      limit: Number(sp.get("limit")) || 50,
    });
    return NextResponse.json({ orders });
  } catch (error) {
    console.log("Error fetching orders for bot:", error);
    return NextResponse.json({ error: "Failed to fetch orders" }, { status: 500 });
  }
}

// POST /api/bot/orders — buyer picks a package; order starts pending_payment.
// Body: { telegramId, username, firstName, packageId }
export async function POST(request) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const { telegramId, username, firstName, packageId } = body || {};
    if (!telegramId || !packageId) {
      return NextResponse.json({ error: "telegramId dan packageId diperlukan" }, { status: 400 });
    }
    const pkg = await getPackageById(packageId);
    if (!pkg) return NextResponse.json({ error: "Paket tidak ditemukan" }, { status: 404 });
    if (!pkg.isActive) return NextResponse.json({ error: "Paket sudah tidak aktif" }, { status: 409 });
    if (pkg.type === "trial") {
      return NextResponse.json({ error: "Paket trial tidak bisa dibeli — klaim lewat menu Trial Gratis" }, { status: 400 });
    }
    const order = await createOrder({
      buyerTelegramId: telegramId,
      buyerTelegramUsername: username || null,
      buyerName: firstName || null,
      packageId: pkg.id,
      packageName: pkg.name,
      amount: pkg.price,
    });
    return NextResponse.json({ order, package: pkg }, { status: 201 });
  } catch (error) {
    console.log("Error creating order for bot:", error);
    return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
  }
}
