import { NextResponse } from "next/server";
import {
  getApiKeys,
  getApiKeysByMemberId,
  createApiKey,
  updateApiKey,
} from "@/lib/localDb";
import { getRequestMemberSession } from "@/lib/auth/memberAuth";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { parseRpmLimit } from "@/shared/utils/rpmLimit.js";
import { parseMaxIps } from "@/shared/utils/ipCap.js";
import { getKeyRateStatus } from "@/sse/services/keyRateLimit.js";
import { getKeyIpStatus } from "@/sse/services/keyIpCap.js";

export const dynamic = "force-dynamic";

async function getMemberSession() {
  return getRequestMemberSession();
}

// Attach the effective RPM limit + current-minute usage and the active-IP
// cap status to each key.
async function withRate(keys) {
  return Promise.all(keys.map(async (k) => ({
    ...k,
    rate: await getKeyRateStatus(k.id).catch(() => null),
    ip: await getKeyIpStatus(k.id).catch(() => null),
  })));
}

// GET /api/keys - List API keys.
// Members see ONLY their own keys (apiKeys.memberId = session.memberId).
export async function GET() {
  try {
    const member = await getMemberSession();
    const keys = member
      ? await getApiKeysByMemberId(member.memberId)
      : await getApiKeys();
    return NextResponse.json({ keys: await withRate(keys) });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - Create new API key (admin only; members are read-only).
export async function POST(request) {
  try {
    if (await getMemberSession()) {
      return NextResponse.json({ error: "Forbidden: members are read-only" }, { status: 403 });
    }
    const body = await request.json();
    const { name, rpmLimit, maxIps } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    // Optional per-key RPM override (null/omitted = inherit package/global).
    let rpm = null;
    if (rpmLimit !== undefined) {
      const checked = parseRpmLimit(rpmLimit);
      if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
      rpm = checked.value;
    }
    // Optional per-key IP cap (schema v9, plan #5): null/omitted = default 3.
    let ips = null;
    if (maxIps !== undefined) {
      const checked = parseMaxIps(maxIps);
      if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
      ips = checked.value;
    }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(name, machineId);
    if (rpm !== null || ips !== null) {
      const updated = await updateApiKey(apiKey.id, {
        ...(rpm !== null ? { rpmLimit: rpm } : {}),
        ...(ips !== null ? { maxIps: ips } : {}),
      });
      apiKey.rpmLimit = updated?.rpmLimit ?? rpm;
      apiKey.maxIps = updated?.maxIps ?? ips;
    }

    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
      rpmLimit: apiKey.rpmLimit ?? null,
      maxIps: apiKey.maxIps ?? null,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
