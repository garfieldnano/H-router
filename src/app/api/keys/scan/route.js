import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/localDb";
import { getRequestMemberSession } from "@/lib/auth/memberAuth";
import {
  runHealthScan,
  getScanState,
  deleteDeadConnections,
} from "@/lib/keys/healthScanner.js";

export const dynamic = "force-dynamic";

// NOTE: the dashboard guard allows member GET on "/api/keys" by prefix, so
// "/api/keys/scan" would pass the guard for members too. The route itself
// enforces admin-only (members get 403 here, not 404 — the scan is an admin
// tool, not a per-member resource).
async function rejectMember() {
  return (await getRequestMemberSession())
    ? NextResponse.json({ error: "Forbidden: members are read-only" }, { status: 403 })
    : null;
}

function publicConnection(c) {
  return {
    id: c.id,
    provider: c.provider,
    name: c.name || c.email || c.id,
    email: c.email || null,
    authType: c.authType,
    isActive: c.isActive,
    healthStatus: c.healthStatus || null,
    healthCheckedAt: c.healthCheckedAt || null,
    healthError: c.healthError || null,
    healthLatencyMs: c.healthLatencyMs ?? null,
    testStatus: c.testStatus || null,
  };
}

// GET /api/keys/scan — scan state + all connections with their health.
export async function GET() {
  try {
    const denied = await rejectMember();
    if (denied) return denied;
    const connections = await getProviderConnections();
    return NextResponse.json({
      scan: getScanState(),
      connections: connections.map(publicConnection),
    });
  } catch (error) {
    console.log("Error fetching scan state:", error);
    return NextResponse.json({ error: "Failed to fetch scan state" }, { status: 500 });
  }
}

// POST /api/keys/scan — start a scan run (async; poll GET for progress).
// 409 when a run is already in progress.
export async function POST() {
  try {
    const denied = await rejectMember();
    if (denied) return denied;
    const state = getScanState();
    if (state.running) {
      return NextResponse.json(
        { error: "A health scan is already running", scan: state },
        { status: 409 }
      );
    }
    // Fire-and-forget: the run continues in the server process; the UI
    // polls GET for progress. Errors are swallowed into the run state.
    runHealthScan().catch((err) => {
      console.log("Health scan failed:", err?.message || err);
    });
    return NextResponse.json({ started: true, scan: getScanState() }, { status: 202 });
  } catch (error) {
    console.log("Error starting scan:", error);
    return NextResponse.json({ error: "Failed to start scan" }, { status: 500 });
  }
}

// DELETE /api/keys/scan — bulk-delete dead connections.
// Body: { connectionIds: [...] }. Only connections whose STORED health
// status is "dead" are deleted; anything else is reported as skipped.
export async function DELETE(request) {
  try {
    const denied = await rejectMember();
    if (denied) return denied;
    const body = await request.json().catch(() => ({}));
    const { connectionIds } = body || {};
    if (!Array.isArray(connectionIds) || connectionIds.length === 0) {
      return NextResponse.json({ error: "connectionIds is required" }, { status: 400 });
    }
    const { deleted, skipped } = await deleteDeadConnections(connectionIds);
    return NextResponse.json({ deleted, skipped, deletedCount: deleted.length });
  } catch (error) {
    console.log("Error deleting dead connections:", error);
    return NextResponse.json({ error: "Failed to delete connections" }, { status: 500 });
  }
}
