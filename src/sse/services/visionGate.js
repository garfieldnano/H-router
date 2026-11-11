// Vision Adapter gate (plan G10) — routing + validation for image requests.
//
// Hooked in src/sse/handlers/chat.js right after brand resolution and the
// key-access / IP-cap / RPM gates, before combo expansion: an image request
// to a model that cannot read images is rejected with a clear 400 naming
// the model + vision-capable alternatives. Text-only requests pass through
// with zero behavior change.
//
// Interaction with the capacity adapter (open-sse/services/capacityAdapter.js):
// when the admin explicitly configured a vision adapter pool (listed pool
// models) holding a vision-capable model, the request is REDIRECTED by that
// machinery instead of rejected (the user definition allows "reject or
// redirect"). The factory-default pool (enabled, no models listed) does NOT
// count — otherwise the default fallback would swallow every rejection and
// the 400 would never fire. The adapter still handles pdf/audio/video
// fallbacks — this gate only covers vision.
//
// Fail-open rules (never block a request we cannot judge): a candidate we
// cannot resolve to a provider/model (e.g. a nested combo name) does not
// count as non-vision. Rejection happens only when EVERY candidate resolves
// to a known non-vision model AND no adapter vision pool can take it.

import { getCapacityAdapterConfig } from "open-sse/services/capacityAdapter.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { AI_MODELS } from "@/shared/constants/models.js";
import { resolveBrandModel } from "@/lib/db/repos/modelBrandsRepo.js";
import { getCustomModels } from "@/lib/localDb";
import { getComboModels } from "./model.js";
import { filterModelsListForKey } from "./keyAccess.js";
import * as log from "../utils/logger.js";
import {
  listVisionAlternatives,
  normalizeVisionKey,
  resolveVisionCapability,
} from "@/shared/utils/visionAdapter.js";

// Custom-model kind map, keyed by model id (same convention as the
// /v1/models route, which keys customModelKindById by model id only).
async function loadCustomKinds() {
  const kinds = new Map();
  try {
    const rows = (await getCustomModels()) || [];
    for (const row of rows) {
      if (!row?.id) continue;
      const kind = row.kind || row.type || null;
      if (kind && !kinds.has(row.id)) kinds.set(row.id, kind);
    }
  } catch (e) {
    log?.warn?.("VISION", `custom-model kind lookup failed (fail-open): ${e?.message || e}`);
  }
  return kinds;
}

// Resolve one model string to its vision capability. Brand ids resolve to
// their upstream FIRST (plan #2: the vision check must use the resolved
// upstream model, never the brand id). Returns { provider, model, vision,
// source, known } — known=false when the string cannot be resolved to a
// provider/model (e.g. a combo name).
export async function resolveModelVision({ modelStr, brandModelId, overrides, customKinds } = {}) {
  let provider = null;
  let model = null;
  let brand = null;
  // The caller's brand id applies only to the exact requested model string.
  if (brandModelId) {
    try {
      const resolved = await resolveBrandModel(brandModelId);
      if (resolved) {
        provider = resolved.provider;
        model = resolved.model;
        brand = resolved.brand;
      }
    } catch (e) {
      log?.warn?.("VISION", `brand resolution failed (fail-open): ${e?.message || e}`);
    }
  }
  if (!provider) {
    try {
      const resolved = await resolveBrandModel(modelStr);
      if (resolved) {
        provider = resolved.provider;
        model = resolved.model;
        brand = resolved.brand;
      }
    } catch {
      // Not a brand id — fall through to provider/model parsing.
    }
  }
  if (!provider) {
    const slash = String(modelStr || "").indexOf("/");
    if (slash > 0) {
      provider = modelStr.slice(0, slash);
      model = modelStr.slice(slash + 1);
    }
  }
  if (!provider || !model) {
    return { provider, model, vision: false, source: "unknown", known: false };
  }
  const customKind = customKinds?.get?.(model) || null;
  const { vision, source } = resolveVisionCapability({
    provider,
    model,
    brandModelId: brand?.brandModelId || brandModelId || null,
    overrides,
    customKind,
  });
  return { provider, model, vision, source, known: true };
}

// Vision-capable models in the admin's capacity-adapter vision pool (the
// redirect path). Returns the pool model strings that can read images.
//
// Only an EXPLICITLY configured pool counts: the admin must have listed
// pool models. The factory default is `vision: { enabled: true, models: [] }`
// and getCapacityAdapterConfig fills an empty enabled pool with the default
// fallback (oc/mimo-v2.6-flash-free, vision-capable) — if that counted as a
// redirect path, the gate would NEVER reject anything out of the box and
// the 400 enforcement would be dead. An empty pool therefore means "no
// redirect configured": the request is rejected with the 400 instead.
function adapterVisionPoolModels(settings, overrides, customKinds) {
  const raw = settings?.capacityAdapter?.vision;
  const explicitModels = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.models)
      ? raw.models
      : [];
  if (explicitModels.length === 0) return [];
  const { enabled, models } = getCapacityAdapterConfig("vision", settings);
  if (!enabled || !Array.isArray(models) || models.length === 0) return [];
  const out = [];
  for (const m of models) {
    const slash = String(m || "").indexOf("/");
    if (slash <= 0) continue;
    const { vision } = resolveVisionCapability({
      provider: m.slice(0, slash),
      model: m.slice(slash + 1),
      overrides,
      customKind: customKinds?.get?.(m.slice(slash + 1)) || null,
    });
    if (vision) out.push(m);
  }
  return out;
}

// Pure gate decision, unit-testable without DB:
//   hasImage   — the request carries image content;
//   candidates — [{ id, vision, known }] for the target model(s);
//   adapterVisionPool — vision-capable models in the configured adapter pool.
// Allowed unless every candidate is a KNOWN non-vision model and no adapter
// pool can take the request.
export function decideVisionGate({ hasImage, candidates, adapterVisionPool } = {}) {
  if (!hasImage) return { allowed: true };
  const list = Array.isArray(candidates) ? candidates : [];
  if (list.some((c) => c?.known && c?.vision)) {
    return { allowed: true, reason: "vision-capable" };
  }
  if (list.some((c) => !c?.known)) {
    return { allowed: true, reason: "unknown-candidate" };
  }
  if (Array.isArray(adapterVisionPool) && adapterVisionPool.length > 0) {
    return { allowed: true, reason: "adapter-redirect" };
  }
  return { allowed: false, reason: "no-vision-model" };
}

// The gate itself. Call after brand resolution + key-access/IP/RPM, before
// combo expansion. Returns null (pass) or a 400 Response.
export async function enforceVisionGate({
  modelStr,
  brandModelId,
  comboModels,
  settings,
  keyAccess,
  requiredCapabilities,
} = {}) {
  if (!requiredCapabilities?.has?.("vision")) return null;
  const overrides = settings?.visionOverrides || {};
  const customKinds = await loadCustomKinds();

  const targets =
    Array.isArray(comboModels) && comboModels.length > 0 ? comboModels : [modelStr];
  const candidates = [];
  for (const target of targets) {
    // A combo member that is itself a combo has no single capability to
    // judge — fail open (the combo machinery routes it, or it fails there).
    if (target !== modelStr) {
      let nested = null;
      try {
        nested = await getComboModels(target);
      } catch {
        nested = null;
      }
      if (nested) {
        candidates.push({ id: target, known: false, vision: false });
        continue;
      }
    }
    const resolved = await resolveModelVision({
      modelStr: target,
      // The outer brand id belongs to the requested model only, never to
      // combo members (each member resolves its own brand, if any).
      brandModelId: target === modelStr ? brandModelId : null,
      overrides,
      customKinds,
    });
    candidates.push({ id: target, ...resolved });
  }

  const pool = adapterVisionPoolModels(settings, overrides, customKinds);
  const decision = decideVisionGate({ hasImage: true, candidates, adapterVisionPool: pool });
  if (decision.allowed) {
    if (decision.reason === "adapter-redirect") {
      log.info("VISION", `image request to "${modelStr}" redirected by capacity-adapter vision pool (${pool.join(", ")})`);
    }
    return null;
  }

  // No vision-capable path: reject with the model name + alternatives the
  // requesting key may actually call.
  const first = candidates[0] || {};
  const alternatives = await listVisionAlternatives({
    provider: first.provider,
    model: first.model,
    catalog: AI_MODELS,
    isAllowed: async (entry) => {
      if (!keyAccess) return true;
      const kept = await filterModelsListForKey(keyAccess, [
        { id: normalizeVisionKey(entry.provider, entry.model), kind: "llm" },
      ]);
      return kept.length > 0;
    },
    overrides,
    customKindsById: customKinds,
    limit: 5,
  });
  const label = brandModelId || modelStr;
  const message =
    alternatives.length > 0
      ? `Model "${label}" cannot read images, but this request includes image content. Try a vision-capable model instead: ${alternatives.join(", ")}.`
      : `Model "${label}" cannot read images, but this request includes image content. Pick a vision-capable model for image requests.`;
  log.warn("VISION", `rejected image request to non-vision model "${label}"`);
  return errorResponse(HTTP_STATUS.BAD_REQUEST, message);
}
