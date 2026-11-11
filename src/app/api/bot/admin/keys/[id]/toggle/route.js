import { NextResponse } from "next/server";
import { requireBotService } from "@/lib/bot/serviceAuth";
import { getApiKeyById, updateApiKey } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// POST /api/bot/admin/keys/[id]/toggle — activate/deactivate a key.
export async function POST(request, { params }) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) return NextResponse.json({ error: "Kunci tidak ditemukan" }, { status: 404 });
    const updated = await updateApiKey(id, { isActive: !key.isActive });
    return NextResponse.json({ key: updated });
  } catch (error) {
    console.log("Error toggling key for bot:", error);
    return NextResponse.json({ error: "Failed to toggle key" }, { status: 500 });
  }
}
