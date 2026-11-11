import { NextResponse } from "next/server";
import { getProxyPools, getRelayStates, clearRelayBan } from "@/lib/localDb";
import { getRequestMemberSession } from "@/lib/auth/memberAuth";

export const dynamic = "force-dynamic";

// Admin-only: members must never see relay ban state (it leaks which
// egress IPs are burned). The middleware blocks member sessions from
// /api/proxy-pools*, this check is defense in depth.
async function forbidMember() {
  if (await getRequestMemberSession()) {
    return NextResponse.json({ error: "Forbidden: admin only" }, { status: 403 });
  }
  return null;
}

// Relay status per pool (plan #1): healthy = never banned or succeeded
// since the last ban; banned = cooldown (bannedUntil) still in the future;
// cooldown = ban expired but the pool hasn't proven healthy since.
export function relayStatusFor(state, nowMs = Date.now()) {
  if (!state) return "healthy";
  if (state.bannedUntil && new Date(state.bannedUntil).getTime() > nowMs) return "banned";
  if (state.lastBanAt && (!state.lastSuccessAt || new Date(state.lastSuccessAt).getTime() < new Date(state.lastBanAt).getTime())) {
    return "cooldown";
  }
  return "healthy";
}

// GET /api/proxy-pools/egress — per-pool relay status for the proxy-pools page.
export async function GET() {
  const forbidden = await forbidMember();
  if (forbidden) return forbidden;
  try {
    const [pools, states] = await Promise.all([getProxyPools(), getRelayStates()]);
    const byPool = new Map(states.map((s) => [s.poolId, s]));
    const now = Date.now();
    const relays = pools.map((pool) => {
      const state = byPool.get(pool.id) || null;
      return {
        id: pool.id,
        name: pool.name,
        type: pool.type,
        proxyUrl: pool.proxyUrl,
        isActive: pool.isActive,
        status: relayStatusFor(state, now),
        bannedUntil: state?.bannedUntil || null,
        lastBanAt: state?.lastBanAt || null,
        lastBanStatus: state?.lastBanStatus ?? null,
        lastBanCode: state?.lastBanCode || null,
        failCount: state?.failCount ?? 0,
        lastSuccessAt: state?.lastSuccessAt || null,
      };
    });
    return NextResponse.json({ relays });
  } catch (error) {
    console.log("Error fetching egress relay status:", error);
    return NextResponse.json({ error: "Failed to fetch relay status" }, { status: 500 });
  }
}

// POST /api/proxy-pools/egress — admin override: { poolId, action: "clear" }
// clears a ban immediately (failCount reset, bannedUntil NULL).
export async function POST(request) {
  const forbidden = await forbidMember();
  if (forbidden) return forbidden;
  try {
    const body = await request.json().catch(() => ({}));
    if (body?.action !== "clear" || typeof body?.poolId !== "string" || !body.poolId) {
      return NextResponse.json({ error: "Expected { poolId, action: \"clear\" }" }, { status: 400 });
    }
    const cleared = await clearRelayBan(body.poolId);
    if (!cleared) {
      return NextResponse.json({ error: "Relay not found" }, { status: 404 });
    }
    return NextResponse.json({ relay: cleared });
  } catch (error) {
    console.log("Error clearing relay ban:", error);
    return NextResponse.json({ error: "Failed to clear relay ban" }, { status: 500 });
  }
}
