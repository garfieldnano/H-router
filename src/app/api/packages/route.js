import { NextResponse } from "next/server";
import { getPackages, createPackage } from "@/lib/localDb";
import { getRequestMemberSession } from "@/lib/auth/memberAuth";

export const dynamic = "force-dynamic";

// Admin-only: the middleware blocks member sessions from /api/packages*,
// this check is defense in depth.
async function forbidMember() {
  if (await getRequestMemberSession()) {
    return NextResponse.json({ error: "Forbidden: admin only" }, { status: 403 });
  }
  return null;
}

// GET /api/packages — list all packages (admin web panel)
export async function GET() {
  try {
    const denied = await forbidMember();
    if (denied) return denied;
    const packages = await getPackages();
    return NextResponse.json({ packages });
  } catch (error) {
    console.log("Error fetching packages:", error);
    return NextResponse.json({ error: "Failed to fetch packages" }, { status: 500 });
  }
}

// POST /api/packages — create a package (admin web panel)
export async function POST(request) {
  try {
    const denied = await forbidMember();
    if (denied) return denied;
    const data = await request.json();
    const pkg = await createPackage(data);
    return NextResponse.json({ package: pkg }, { status: 201 });
  } catch (error) {
    console.log("Error creating package:", error);
    return NextResponse.json({ error: error.message || "Failed to create package" }, { status: 400 });
  }
}
