import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import {
  checkLock,
  recordFail,
  recordSuccess,
  getClientIp,
} from "@/lib/auth/loginLimiter";
import { validateApiKey, getApiKeyByKey, getMemberById } from "@/lib/localDb";

export const dynamic = "force-dynamic";

/**
 * Member web login (v1): POST { apiKey }.
 * The API key is sent ONCE to obtain a dashboard session cookie; the raw
 * key is NOT stored in the browser afterwards. The session JWT carries
 * { role: "member", memberId, keyId } (24h, same as admin).
 *
 * The key must be active and assigned to a member (apiKeys.memberId), and
 * that member must exist and be active. Keys without a member (admin keys)
 * cannot log in as a member — use the admin password login instead.
 */
export async function POST(request) {
  const ip = getClientIp(request.headers);
  const lock = checkLock(ip, "member-login");
  if (lock.locked) {
    return NextResponse.json(
      { error: "Terlalu banyak percobaan login. Coba lagi nanti." },
      { status: 429 }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";

    if (!apiKey) {
      recordFail(ip, "member-login");
      return NextResponse.json({ error: "API key diperlukan" }, { status: 400 });
    }

    const valid = await validateApiKey(apiKey);
    if (!valid) {
      recordFail(ip, "member-login");
      return NextResponse.json({ error: "API key tidak valid" }, { status: 401 });
    }

    const keyRow = await getApiKeyByKey(apiKey);
    if (!keyRow?.memberId) {
      recordFail(ip, "member-login");
      return NextResponse.json(
        { error: "API key ini tidak terhubung ke member" },
        { status: 403 }
      );
    }

    const member = await getMemberById(keyRow.memberId);
    if (!member || !member.isActive) {
      recordFail(ip, "member-login");
      return NextResponse.json(
        { error: "Member tidak aktif atau tidak ditemukan" },
        { status: 403 }
      );
    }

    recordSuccess(ip, "member-login");
    const cookieStore = await cookies();
    await setDashboardAuthCookie(cookieStore, request, {
      role: "member",
      memberId: member.id,
      keyId: keyRow.id,
      memberName: member.name || member.email || "Member",
    });
    return NextResponse.json({
      success: true,
      role: "member",
      memberId: member.id,
      memberName: member.name || member.email || "Member",
    });
  } catch (error) {
    console.error("[member-login] failed:", error);
    return NextResponse.json({ error: "Gagal login" }, { status: 500 });
  }
}
