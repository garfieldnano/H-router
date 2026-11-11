import { NextResponse } from "next/server";
import { getPackageById, updatePackage, deletePackage } from "@/lib/localDb";
import { getRequestMemberSession } from "@/lib/auth/memberAuth";

export const dynamic = "force-dynamic";

async function forbidMember() {
  if (await getRequestMemberSession()) {
    return NextResponse.json({ error: "Forbidden: admin only" }, { status: 403 });
  }
  return null;
}

export async function GET(request, { params }) {
  try {
    const denied = await forbidMember();
    if (denied) return denied;
    const { id } = await params;
    const pkg = await getPackageById(id);
    if (!pkg) return NextResponse.json({ error: "Package not found" }, { status: 404 });
    return NextResponse.json({ package: pkg });
  } catch (error) {
    console.log("Error fetching package:", error);
    return NextResponse.json({ error: "Failed to fetch package" }, { status: 500 });
  }
}

// PUT /api/packages/[id] — edit a package incl. price (admin web panel)
export async function PUT(request, { params }) {
  try {
    const denied = await forbidMember();
    if (denied) return denied;
    const { id } = await params;
    const data = await request.json();
    const pkg = await updatePackage(id, data);
    if (!pkg) return NextResponse.json({ error: "Package not found" }, { status: 404 });
    return NextResponse.json({ package: pkg });
  } catch (error) {
    console.log("Error updating package:", error);
    return NextResponse.json({ error: error.message || "Failed to update package" }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const denied = await forbidMember();
    if (denied) return denied;
    const { id } = await params;
    const deleted = await deletePackage(id);
    if (!deleted) return NextResponse.json({ error: "Package not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.log("Error deleting package:", error);
    return NextResponse.json({ error: "Failed to delete package" }, { status: 500 });
  }
}
