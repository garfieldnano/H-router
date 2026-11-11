import { NextResponse } from "next/server";
import { requireBotService } from "@/lib/bot/serviceAuth";
import { getPackages } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// GET /api/bot/packages — active packages for the bot's buy menu.
export async function GET(request) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const packages = await getPackages({ activeOnly: true });
    return NextResponse.json({ packages });
  } catch (error) {
    console.log("Error fetching packages for bot:", error);
    return NextResponse.json({ error: "Failed to fetch packages" }, { status: 500 });
  }
}
