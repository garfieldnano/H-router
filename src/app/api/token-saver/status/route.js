import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// GET /api/token-saver/status — member-safe read-only Token Saver state.
// Returns ONLY the RTK switch + per-model overrides from settings; the
// full settings blob (passwords, bot tokens, tunnel config) is never
// exposed to members. Used by the member Token Saver page.
export async function GET() {
  try {
    const settings = await getSettings();
    return NextResponse.json({
      rtkEnabled: settings?.rtkEnabled !== false,
      rtkModelOverrides: settings?.rtkModelOverrides || {},
    });
  } catch (error) {
    console.log("Error fetching token-saver status:", error);
    return NextResponse.json({ error: "Failed to fetch token-saver status" }, { status: 500 });
  }
}
