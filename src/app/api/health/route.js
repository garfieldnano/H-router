import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/db/driver.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

// GET /api/health — public liveness probe for the landing page.
// Returns { ok: true, requests24h } where requests24h is the number of
// gateway requests logged in the last 24h (the dashboard preview's
// "REQUEST 24 JAM" stat). The count is best-effort: if the DB read fails
// for any reason it is null (the landing renders a dash) instead of
// failing the health check itself.
export async function GET() {
  let requests24h = null;
  try {
    const db = await getAdapter();
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const row = db.get(`SELECT COUNT(*) AS c FROM usageHistory WHERE timestamp >= ?`, [cutoff]);
    if (row && Number.isFinite(row.c)) requests24h = row.c;
  } catch {}
  return NextResponse.json({ ok: true, requests24h }, { headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
