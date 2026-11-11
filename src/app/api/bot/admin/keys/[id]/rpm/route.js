import { NextResponse } from "next/server";
import { requireBotService } from "@/lib/bot/serviceAuth";
import { getApiKeyById, updateApiKey } from "@/lib/localDb";
import { parseRpmLimit } from "@/shared/utils/rpmLimit.js";

export const dynamic = "force-dynamic";

// POST /api/bot/admin/keys/[id]/rpm — set a key's per-key RPM limit.
// Body: { rpmLimit: number|null } — null (or empty) clears the override so
// the key inherits its package / the global default.
export async function POST(request, { params }) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) return NextResponse.json({ error: "Key tidak ditemukan" }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    const checked = parseRpmLimit(body.rpmLimit);
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
    const updated = await updateApiKey(id, { rpmLimit: checked.value });
    return NextResponse.json({ key: updated });
  } catch (error) {
    console.log("Error setting key RPM from bot:", error);
    return NextResponse.json({ error: "Failed to set key RPM" }, { status: 500 });
  }
}
