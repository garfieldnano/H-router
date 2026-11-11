import { NextResponse } from "next/server";
import { getModelBrandById, updateModelBrand, deleteModelBrand } from "@/lib/localDb";
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
    const brand = await getModelBrandById(id);
    if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });
    return NextResponse.json({ brand });
  } catch (error) {
    console.log("Error fetching model brand:", error);
    return NextResponse.json({ error: "Failed to fetch model brand" }, { status: 500 });
  }
}

// PUT /api/model-brands/[id] — edit a brand mapping (admin web panel)
export async function PUT(request, { params }) {
  try {
    const denied = await forbidMember();
    if (denied) return denied;
    const { id } = await params;
    const data = await request.json();
    const brand = await updateModelBrand(id, data);
    if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });
    return NextResponse.json({ brand });
  } catch (error) {
    console.log("Error updating model brand:", error);
    return NextResponse.json({ error: error.message || "Failed to update model brand" }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const denied = await forbidMember();
    if (denied) return denied;
    const { id } = await params;
    const deleted = await deleteModelBrand(id);
    if (!deleted) return NextResponse.json({ error: "Brand not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.log("Error deleting model brand:", error);
    return NextResponse.json({ error: "Failed to delete model brand" }, { status: 500 });
  }
}
