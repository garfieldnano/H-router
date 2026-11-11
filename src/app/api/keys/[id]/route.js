import { NextResponse } from "next/server";
import { deleteApiKey, deleteIpUsageForKey, getApiKeyById, getPackageById, updateApiKey } from "@/lib/localDb";
import { getRequestMemberSession } from "@/lib/auth/memberAuth";
import { validateKeyAccessInput } from "@/shared/utils/keyAccess.js";
import { parseRpmLimit } from "@/shared/utils/rpmLimit.js";
import { parseMaxIps } from "@/shared/utils/ipCap.js";
import { getKeyRateStatus } from "@/sse/services/keyRateLimit.js";
import { getKeyIpStatus } from "@/sse/services/keyIpCap.js";

// A member may only read keys assigned to them; any write is admin-only.
// A non-owned key reads as 404 (not 403) so existence is not leaked.
async function memberCannotSee(member, key) {
  return member && key?.memberId !== member.memberId;
}

// GET /api/keys/[id] - Get single key
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const member = await getRequestMemberSession();
    const key = await getApiKeyById(id);
    if (!key || (await memberCannotSee(member, key))) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    return NextResponse.json({ key: { ...key, rate: await getKeyRateStatus(id).catch(() => null), ip: await getKeyIpStatus(id).catch(() => null) } });
  } catch (error) {
    console.log("Error fetching key:", error);
    return NextResponse.json({ error: "Failed to fetch key" }, { status: 500 });
  }
}

// PUT /api/keys/[id] - Update key (admin only)
export async function PUT(request, { params }) {
  try {
    if (await getRequestMemberSession()) {
      return NextResponse.json({ error: "Forbidden: members are read-only" }, { status: 403 });
    }
    const { id } = await params;
    const body = await request.json();
    const { isActive, access, rpmLimit, maxIps, packageId } = body;

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const updateData = {};
    if (isActive !== undefined) updateData.isActive = isActive;
    if (access !== undefined) {
      const checked = validateKeyAccessInput(access);
      if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
      updateData.access = checked.value;
    }
    // RPM (schema v5): per-key override; null/empty clears it (inherit).
    if (rpmLimit !== undefined) {
      const checked = parseRpmLimit(rpmLimit);
      if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
      updateData.rpmLimit = checked.value;
    }
    // IP cap (schema v9, plan #5): per-key override; null/empty clears it
    // (back to the default 3).
    if (maxIps !== undefined) {
      const checked = parseMaxIps(maxIps);
      if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
      updateData.maxIps = checked.value;
    }
    // Package assignment (schema v5): which package's default this key
    // inherits; null clears it (admin key → global default).
    if (packageId !== undefined) {
      if (packageId === null || packageId === "") {
        updateData.packageId = null;
      } else {
        const pkg = await getPackageById(packageId);
        if (!pkg) return NextResponse.json({ error: "Paket tidak ditemukan" }, { status: 400 });
        updateData.packageId = pkg.id;
      }
    }

    const updated = await updateApiKey(id, updateData);

    return NextResponse.json({ key: { ...updated, rate: await getKeyRateStatus(id).catch(() => null), ip: await getKeyIpStatus(id).catch(() => null) } });
  } catch (error) {
    console.log("Error updating key:", error);
    return NextResponse.json({ error: "Failed to update key" }, { status: 500 });
  }
}

// DELETE /api/keys/[id] - Delete API key (admin only)
export async function DELETE(request, { params }) {
  try {
    if (await getRequestMemberSession()) {
      return NextResponse.json({ error: "Forbidden: members are read-only" }, { status: 403 });
    }
    const { id } = await params;

    const deleted = await deleteApiKey(id);
    if (!deleted) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    // Drop the key's IP window rows too (the periodic sweep would age them
    // out anyway, but a deleted key must not keep counting anywhere).
    await deleteIpUsageForKey(id).catch(() => 0);

    return NextResponse.json({ message: "Key deleted successfully" });
  } catch (error) {
    console.log("Error deleting key:", error);
    return NextResponse.json({ error: "Failed to delete key" }, { status: 500 });
  }
}
