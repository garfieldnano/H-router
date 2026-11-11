import { NextResponse } from "next/server";
import {
  getMemberById,
  updateMember,
  getApiKeysByMemberId,
  getApiKeyById,
  setApiKeyMember,
} from "@/lib/localDb";
import { getRequestMemberSession } from "@/lib/auth/memberAuth";
import { maskApiKey } from "@/shared/utils/apiKey";

export const dynamic = "force-dynamic";

async function forbidMember() {
  if (await getRequestMemberSession()) {
    return NextResponse.json({ error: "Forbidden: admin only" }, { status: 403 });
  }
  return null;
}

async function memberWithKeys(member) {
  const keys = await getApiKeysByMemberId(member.id);
  return {
    ...member,
    keys: keys.map((k) => ({
      id: k.id,
      name: k.name,
      keyMasked: maskApiKey(k.key),
      isActive: k.isActive,
      createdAt: k.createdAt,
    })),
  };
}

// GET /api/members/[id] - Get one member with assigned keys
export async function GET(request, { params }) {
  try {
    const denied = await forbidMember();
    if (denied) return denied;
    const { id } = await params;
    const member = await getMemberById(id);
    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }
    return NextResponse.json({ member: await memberWithKeys(member) });
  } catch (error) {
    console.log("Error fetching member:", error);
    return NextResponse.json({ error: "Failed to fetch member" }, { status: 500 });
  }
}

// PATCH /api/members/[id] - Update member.
// Body: { name?, email?, isActive?, assignKeyId?, unassignKeyId? }
// Assigning a key to another member moves it (one key = one member).
export async function PATCH(request, { params }) {
  try {
    const denied = await forbidMember();
    if (denied) return denied;
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const member = await getMemberById(id);
    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    if (body.assignKeyId) {
      const key = await getApiKeyById(body.assignKeyId);
      if (!key) {
        return NextResponse.json({ error: "API key not found" }, { status: 404 });
      }
      await setApiKeyMember(key.id, member.id);
    }

    if (body.unassignKeyId) {
      const key = await getApiKeyById(body.unassignKeyId);
      if (!key) {
        return NextResponse.json({ error: "API key not found" }, { status: 404 });
      }
      if (key.memberId !== member.id) {
        return NextResponse.json({ error: "API key is not assigned to this member" }, { status: 400 });
      }
      await setApiKeyMember(key.id, null);
    }

    const updateData = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.email !== undefined) updateData.email = body.email;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;
    if (Object.keys(updateData).length) {
      await updateMember(id, updateData);
    }

    const updated = await getMemberById(id);
    return NextResponse.json({ member: await memberWithKeys(updated) });
  } catch (error) {
    console.log("Error updating member:", error);
    return NextResponse.json({ error: "Failed to update member" }, { status: 500 });
  }
}
