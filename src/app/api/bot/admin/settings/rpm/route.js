import { NextResponse } from "next/server";
import { requireBotService } from "@/lib/bot/serviceAuth";
import { getSettings, updateSettings } from "@/lib/localDb";
import { parseRpmLimit, GLOBAL_DEFAULT_RPM } from "@/shared/utils/rpmLimit.js";

export const dynamic = "force-dynamic";

// POST /api/bot/admin/settings/rpm — set the global default RPM.
// Body: { defaultRpmLimit: number } — must be a positive integer (no
// unlimited tier); keys with no per-key and no per-package limit use this.
export async function POST(request) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({}));
    const checked = parseRpmLimit(body.defaultRpmLimit);
    if (!checked.ok || checked.value === null) {
      return NextResponse.json(
        { error: "defaultRpmLimit harus bilangan bulat 1–10000 (tidak ada unlimited)" },
        { status: 400 }
      );
    }
    await updateSettings({ defaultRpmLimit: checked.value });
    const settings = await getSettings();
    return NextResponse.json({ defaultRpmLimit: settings.defaultRpmLimit ?? GLOBAL_DEFAULT_RPM });
  } catch (error) {
    console.log("Error setting global RPM from bot:", error);
    return NextResponse.json({ error: "Failed to set global RPM" }, { status: 500 });
  }
}
