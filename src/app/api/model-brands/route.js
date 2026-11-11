import { NextResponse } from "next/server";
import { getModelBrands, createModelBrand } from "@/lib/localDb";
import { getRequestMemberSession } from "@/lib/auth/memberAuth";

export const dynamic = "force-dynamic";

// Admin-only: the dashboard guard blocks member sessions from
// /api/model-brands*, this check is defense in depth.
async function forbidMember() {
  if (await getRequestMemberSession()) {
    return NextResponse.json({ error: "Forbidden: admin only" }, { status: 403 });
  }
  return null;
}

// GET /api/model-brands — list brand mappings (admin web panel)
export async function GET() {
  try {
    const denied = await forbidMember();
    if (denied) return denied;
    const brands = await getModelBrands();
    return NextResponse.json({ brands });
  } catch (error) {
    console.log("Error fetching model brands:", error);
    return NextResponse.json({ error: "Failed to fetch model brands" }, { status: 500 });
  }
}

// POST /api/model-brands — create a brand mapping (admin web panel)
export async function POST(request) {
  try {
    const denied = await forbidMember();
    if (denied) return denied;
    const data = await request.json();
    const brand = await createModelBrand(data);
    return NextResponse.json({ brand }, { status: 201 });
  } catch (error) {
    console.log("Error creating model brand:", error);
    return NextResponse.json({ error: error.message || "Failed to create model brand" }, { status: 400 });
  }
}
