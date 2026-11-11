import { NextResponse } from "next/server";
import { requireBotService } from "@/lib/bot/serviceAuth";
import { getPackages, createPackage } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// GET /api/bot/admin/packages — all packages (incl. inactive) for the admin panel.
export async function GET(request) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const packages = await getPackages();
    return NextResponse.json({ packages });
  } catch (error) {
    console.log("Error fetching admin packages for bot:", error);
    return NextResponse.json({ error: "Failed to fetch packages" }, { status: 500 });
  }
}

// POST /api/bot/admin/packages — create a package from the bot admin panel.
export async function POST(request) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const data = await request.json();
    const pkg = await createPackage(data);
    return NextResponse.json({ package: pkg }, { status: 201 });
  } catch (error) {
    console.log("Error creating package from bot:", error);
    return NextResponse.json({ error: error.message || "Failed to create package" }, { status: 400 });
  }
}
