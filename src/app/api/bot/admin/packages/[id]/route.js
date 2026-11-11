import { NextResponse } from "next/server";
import { requireBotService } from "@/lib/bot/serviceAuth";
import { getPackageById, updatePackage, deletePackage } from "@/lib/localDb";

export const dynamic = "force-dynamic";

export async function PUT(request, { params }) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const data = await request.json();
    const pkg = await updatePackage(id, data);
    if (!pkg) return NextResponse.json({ error: "Package not found" }, { status: 404 });
    return NextResponse.json({ package: pkg });
  } catch (error) {
    console.log("Error updating package from bot:", error);
    return NextResponse.json({ error: error.message || "Failed to update package" }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const deleted = await deletePackage(id);
    if (!deleted) return NextResponse.json({ error: "Package not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.log("Error deleting package from bot:", error);
    return NextResponse.json({ error: "Failed to delete package" }, { status: 500 });
  }
}
