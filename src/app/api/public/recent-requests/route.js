import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/db/driver.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const LIMIT = 4;

// GET /api/public/recent-requests — public recent-request feed for the
// landing page's "Aliran permintaan" preview. Returns the last LIMIT
// gateway requests in the last 24h, newest first:
// { requests: [{ timestamp, model, endpoint, status, tokens }] }.
// Only anonymous, non-sensitive columns are exposed — never the caller's
// apiKey, connectionId, cost, or meta. A request is "real" by definition:
// this reads usageHistory, the same table the "REQUEST 24 JAM" /
// "TOKEN 24 JAM" stats count. When there is no traffic in the window the
// list is empty (the landing says so, instead of inventing rows). On a
// DB error `requests` is null (the landing renders a dash) instead of
// failing the request.
export async function GET() {
  let requests = null;
  try {
    const db = await getAdapter();
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const rows = db.all(
      `SELECT timestamp, model, endpoint, status, promptTokens, completionTokens
       FROM usageHistory WHERE timestamp >= ? ORDER BY id DESC LIMIT ?`,
      [cutoff, LIMIT]
    );
    requests = (Array.isArray(rows) ? rows : []).map((r) => ({
      timestamp: typeof r.timestamp === "string" ? r.timestamp : null,
      model: typeof r.model === "string" ? r.model : null,
      endpoint: typeof r.endpoint === "string" ? r.endpoint : null,
      status: typeof r.status === "string" ? r.status : "ok",
      tokens:
        (Number.isFinite(r.promptTokens) ? r.promptTokens : 0) +
        (Number.isFinite(r.completionTokens) ? r.completionTokens : 0),
    }));
  } catch {}
  return NextResponse.json({ requests }, { headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
