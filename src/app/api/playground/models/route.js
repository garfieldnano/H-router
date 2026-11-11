import { NextResponse } from "next/server";
import { getModelBrands, getApiKeys } from "@/lib/localDb";
import { getRequestMemberSession } from "@/lib/auth/memberAuth";
import { buildModelsList } from "@/app/api/v1/models/route.js";
import { applyModelBrands } from "@/shared/utils/brandModel.js";

export const dynamic = "force-dynamic";

// Admin-only: the dashboard guard blocks member sessions from
// /api/playground*, this check is defense in depth.
async function forbidMember() {
  if (await getRequestMemberSession()) {
    return NextResponse.json({ error: "Forbidden: admin only" }, { status: 403 });
  }
  return null;
}

function maskKey(key) {
  if (!key || typeof key !== "string") return null;
  const trimmed = key.trim();
  if (trimmed.length <= 12) return `${trimmed.charAt(0)}***`;
  return `${trimmed.slice(0, 8)}***${trimmed.slice(-4)}`;
}

// GET /api/playground/models[?full=1] — the model picker for the Playground (G7).
// Returns the same list /v1/models serves (live catalog + brands applied,
// owned_by h-router) WITHOUT per-key filtering — the playground is
// admin-only, so the admin sees everything. `brands` is the short list
// the picker shows first; "Muat semua model" fetches with ?full=1 to
// reveal the full `models` list (the live catalog lookup can take a few
// seconds, so it is not paid on every page load). Also returns the active
// API keys (masked) the playground call can run as — full key values
// never leave the server.
export async function GET(request) {
  try {
    const denied = await forbidMember();
    if (denied) return denied;

    const full = new URL(request.url).searchParams.get("full") === "1";
    const [brands, keys] = await Promise.all([
      getModelBrands({ activeOnly: true }),
      getApiKeys(),
    ]);
    let models = [];
    if (full) {
      models = await buildModelsList(["llm"], {});
      try {
        models = applyModelBrands(models, brands || [], {});
      } catch {
        // Fail-open: serve the unbranded list rather than 500 the picker.
      }
    }

    return NextResponse.json({
      brands: (brands || []).map((b) => ({
        id: b.brandModelId,
        displayName: b.displayName || b.brandModelId,
        upstream: `${b.upstreamProvider}/${b.upstreamModel}`,
      })),
      models: (models || []).map((m) => ({
        id: m.id,
        ownedBy: m.owned_by || null,
        contextLength: m.context_length ?? null,
      })),
      keys: (keys || [])
        .filter((k) => k.isActive !== false && k.isActive !== 0)
        .map((k) => ({ id: k.id, name: k.name || k.id, maskedKey: maskKey(k.key) })),
    });
  } catch (error) {
    console.error("[API] Failed to fetch playground models:", error);
    return NextResponse.json({ error: "Failed to fetch playground models" }, { status: 500 });
  }
}
