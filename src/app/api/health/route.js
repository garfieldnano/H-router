import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/db/driver.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

// GET /api/health — public liveness probe for the landing page.
// Returns { ok: true, requests24h, tokens24h } where requests24h is the
// number of gateway requests logged in the last 24h and tokens24h is the
// total prompt + completion tokens in the same window (the dashboard
// preview's "REQUEST 24 JAM" and "TOKEN 24 JAM" stats). Both counts are
// best-effort: if the DB read fails for any reason they are null (the
// landing renders a dash) instead of failing the health check itself.
export async function GET() {
  let requests24h = null;
  let tokens24h = null;
  try {
    const db = await getAdapter();
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const row = db.get(
      `SELECT COUNT(*) AS c, COALESCE(SUM(promptTokens + completionTokens), 0) AS t FROM usageHistory WHERE timestamp >= ?`,
      [cutoff]
    );
    if (row && Number.isFinite(row.c)) requests24h = row.c;
    if (row && Number.isFinite(row.t)) tokens24h = row.t;
  } catch {}
  return NextResponse.json({ ok: true, requests24h, tokens24h }, { headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
