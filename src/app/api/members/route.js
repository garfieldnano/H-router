import { NextResponse } from "next/server";
import {
  getMembers,
  createMember,
  getMemberByEmail,
  getApiKeys,
} from "@/lib/localDb";
import { getRequestMemberSession } from "@/lib/auth/memberAuth";
import { maskApiKey } from "@/shared/utils/apiKey";

export const dynamic = "force-dynamic";

// Admin-only: the middleware blocks member sessions from /api/members*,
// this check is defense in depth.
async function forbidMember() {
  if (await getRequestMemberSession()) {
    return NextResponse.json({ error: "Forbidden: admin only" }, { status: 403 });
  }
  return null;
}

// GET /api/members - List members with their assigned keys
export async function GET() {
  try {
    const denied = await forbidMember();
    if (denied) return denied;

    const [members, keys] = await Promise.all([getMembers(), getApiKeys()]);
    const byMember = new Map();
    for (const k of keys) {
      if (!k.memberId) continue;
      if (!byMember.has(k.memberId)) byMember.set(k.memberId, []);
      byMember.get(k.memberId).push({
        id: k.id,
        name: k.name,
        keyMasked: maskApiKey(k.key),
        isActive: k.isActive,
        createdAt: k.createdAt,
      });
    }
    const unassigned = keys
      .filter((k) => !k.memberId)
      .map((k) => ({
        id: k.id,
        name: k.name,
        keyMasked: maskApiKey(k.key),
        isActive: k.isActive,
        createdAt: k.createdAt,
      }));

    return NextResponse.json({
      members: members.map((m) => ({ ...m, keys: byMember.get(m.id) || [] })),
      unassignedKeys: unassigned,
    });
  } catch (error) {
    console.log("Error fetching members:", error);
    return NextResponse.json({ error: "Failed to fetch members" }, { status: 500 });
  }
}

// POST /api/members - Create member (name + email; no password —
// members log in with an assigned API key)
export async function POST(request) {
  try {
    const denied = await forbidMember();
    if (denied) return denied;

    const body = await request.json().catch(() => ({}));
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const existing = await getMemberByEmail(email);
    if (existing) {
      return NextResponse.json({ error: "Member with this email already exists" }, { status: 409 });
    }

    const member = await createMember({ name, email });
    return NextResponse.json({ member: { ...member, keys: [] } }, { status: 201 });
  } catch (error) {
    if (String(error?.message || "").includes("UNIQUE")) {
      return NextResponse.json({ error: "Member with this email already exists" }, { status: 409 });
    }
    console.log("Error creating member:", error);
    return NextResponse.json({ error: "Failed to create member" }, { status: 500 });
  }
}
