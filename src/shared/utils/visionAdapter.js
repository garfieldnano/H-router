// Vision Adapter — vision routing + validation (plan G10).
// Pure helpers: no DB, no I/O — safe to import from unit tests and from
// both the Next.js routes and the open-sse engine.
//
// Definition (user, 2026-11-11): a request carrying image content may only
// go to a vision-capable model. A non-vision model gets a clear 400 naming
// the model + vision-capable alternatives (or the request is redirected by
// the capacity adapter when a vision pool is explicitly configured — the
// gate in src/sse/services/visionGate.js owns that decision).
// There is NO image-to-text bridge: `imageToText` in this codebase is only
// a media-provider model kind (image-in → text-out models), not an adapter.

import {
  capabilitiesFromServiceKind,
  getCapabilitiesForModel,
} from "open-sse/providers/capabilities.js";
import { PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";

// Provider ids and UI aliases are not the same string for every provider
// (e.g. an alias like "oc" vs its provider id). Override keys are written
// in whichever form the admin used, so lookups try all spellings.
const ALIAS_TO_PROVIDER_ID = Object.fromEntries(
  Object.entries(PROVIDER_ID_TO_ALIAS || {}).map(([id, alias]) => [alias, id]),
);

function visionKeyVariants(provider, model) {
  const p = String(provider || "").trim();
  const m = String(model || "").trim();
  if (!p || !m) return [];
  const variants = [`${p}/${m}`];
  const alias = PROVIDER_ID_TO_ALIAS?.[p];
  if (alias && alias !== p) variants.push(`${alias}/${m}`);
  const id = ALIAS_TO_PROVIDER_ID?.[p];
  if (id && id !== p) variants.push(`${id}/${m}`);
  return variants;
}

// ---------------------------------------------------------------------------
// Image detection
// ---------------------------------------------------------------------------

function mimeIsImage(mime) {
  return typeof mime === "string" && mime.toLowerCase().startsWith("image/");
}

function dataUrlIsImage(url) {
  if (typeof url !== "string") return false;
  const m = url.match(/^data:([^;,]+)/);
  return m ? mimeIsImage(m[1]) : false;
}

function partHasImage(part) {
  if (!part || typeof part !== "object") return false;
  const t = part.type;
  // OpenAI-compat: { type: "image_url", image_url: { url } }
  // Claude: { type: "image", source: { type: "base64"|"url", ... } }
  // Responses API: { type: "input_image", image_url } — any of these is an image.
  if (t === "image_url" || t === "image" || t === "input_image") return true;
  // Gemini parts: { inlineData: { mimeType, data } } / { fileData: { mimeType } }
  if (mimeIsImage(part.inlineData?.mimeType) || mimeIsImage(part.fileData?.mimeType)) return true;
  // Generic file/document part carrying an image mime
  if (t === "file" || t === "document" || t === "input_file") {
    const fmime =
      part.input_audio?.format ? `audio/${part.input_audio.format}` :
      part.file?.file_data ? String(part.file.file_data).match(/^data:([^;,]+)/)?.[1] :
      part.source?.media_type || null;
    if (fmime) return mimeIsImage(fmime);
    if (part.source?.data) return dataUrlIsImage(String(part.source.data));
  }
  return false;
}

function attachmentsHaveImage(message) {
  const attachments = message.experimental_attachments || message.attachments;
  if (!Array.isArray(attachments)) return false;
  for (const att of attachments) {
    if (!att) continue;
    const mime =
      att.contentType || att.mediaType ||
      (typeof att.url === "string" && att.url.match(/^data:([^;,]+)/)?.[1]);
    if (mime) {
      if (mimeIsImage(mime)) return true;
    } else if (att.url || att.data) {
      return true;
    }
  }
  return false;
}

function messageHasImage(message) {
  if (!message || typeof message !== "object") return false;
  // Ollama / Hermes: message.images (strings or objects)
  if (Array.isArray(message.images) && message.images.length > 0) return true;
  if (attachmentsHaveImage(message)) return true;
  const content = message.content;
  if (Array.isArray(content)) return content.some(partHasImage);
  return false;
}

// Does this chat request carry image content? Scans messages[] (OpenAI,
// Claude, Gemini, Ollama shapes) and the Responses-API `input` array.
// Text-only requests return false — the vision gate must never touch them.
export function hasImageContent(body) {
  if (!body || typeof body !== "object") return false;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.some(messageHasImage)) return true;
  // OpenAI Responses API: body.input is a message array with the same shapes.
  if (Array.isArray(body.input) && body.input.some(messageHasImage)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Vision capability lookup
// ---------------------------------------------------------------------------

// Canonical override key: "provider/model" (brand ids use the same shape).
export function normalizeVisionKey(provider, model) {
  return `${String(provider || "").trim()}/${String(model || "").trim()}`;
}

// Admin override lookup. Brand id wins over provider/model (a brand is the
// more specific target, mirroring the live-prompt priority in plan #2).
// Provider/model keys are tried in every alias/id spelling, so an override
// written as "oc/gpt-5" also matches a request for "cx/gpt-5" and vice versa.
// Returns true/false when an override exists, undefined otherwise.
export function lookupVisionOverride(overrides, { provider, model, brandModelId } = {}) {
  if (!overrides || typeof overrides !== "object") return undefined;
  if (brandModelId && typeof overrides[brandModelId] === "boolean") {
    return overrides[brandModelId];
  }
  for (const key of visionKeyVariants(provider, model)) {
    if (typeof overrides[key] === "boolean") return overrides[key];
  }
  return undefined;
}

// Resolve whether a model can read images. Sources, in order:
//   1. admin override (settings.visionOverrides) — wins over everything;
//   2. media-provider service kind (imageToText models are vision-capable);
//   3. the capability tables (exact entries → patterns → catalog → name
//      heuristic) via getCapabilitiesForModel.
// Returns { vision, source } where source is "override" | "service-kind" |
// "capabilities".
export function resolveVisionCapability({ provider, model, brandModelId, overrides, customKind } = {}) {
  const override = lookupVisionOverride(overrides, { provider, model, brandModelId });
  if (typeof override === "boolean") {
    return { vision: override, source: "override" };
  }
  if (customKind) {
    const serviceCaps = capabilitiesFromServiceKind(customKind);
    if (serviceCaps && typeof serviceCaps.vision === "boolean") {
      return { vision: serviceCaps.vision, source: "service-kind" };
    }
  }
  const caps = getCapabilitiesForModel(provider, model);
  return { vision: caps?.vision === true, source: "capabilities" };
}

// Apply an admin override to a capabilities object (e.g. the `capabilities`
// block /v1/models emits). `key` is a "provider/model" id; all alias/id
// spellings are tried. Returns the input unchanged when no override
// applies; otherwise a shallow copy with vision replaced.
export function applyVisionOverrideToCaps(caps, key, overrides) {
  if (!caps || typeof caps !== "object") return caps;
  if (!key || !overrides || typeof overrides !== "object") return caps;
  const slash = String(key).indexOf("/");
  const variants =
    slash > 0
      ? visionKeyVariants(key.slice(0, slash), key.slice(slash + 1))
      : [String(key)];
  for (const variant of variants) {
    const override = overrides[variant];
    if (typeof override !== "boolean") continue;
    if (caps.vision === override) return caps;
    return { ...caps, vision: override };
  }
  return caps;
}

// ---------------------------------------------------------------------------
// Alternatives
// ---------------------------------------------------------------------------

// Vision-capable alternatives for a rejected request, from a flat model
// catalog ([{ provider, model, name }], e.g. AI_MODELS). Same-provider
// models first, then any provider; each candidate must pass isAllowed
// (async predicate — the caller wires key-access filtering) and resolve
// vision-capable via the capability tables + overrides. Returns up to
// `limit` "provider/model" strings, never the rejected model itself.
export async function listVisionAlternatives({
  provider,
  model,
  catalog,
  isAllowed,
  overrides,
  customKindsById,
  limit = 5,
} = {}) {
  const out = [];
  const seen = new Set();
  const rejectedKey = provider && model ? normalizeVisionKey(provider, model) : null;
  const entries = Array.isArray(catalog) ? catalog : [];
  const allowed = async (entry) => {
    if (typeof isAllowed !== "function") return true;
    try {
      return (await isAllowed(entry)) !== false;
    } catch {
      return false;
    }
  };
  const consider = async (entry) => {
    if (out.length >= limit) return;
    const key = normalizeVisionKey(entry.provider, entry.model);
    if (!key || key === rejectedKey || seen.has(key)) return;
    seen.add(key);
    // Vision first (in-memory, cheap), access check second (DB-backed) so
    // the global pass does not pay a key-access lookup per catalog entry.
    const { vision } = resolveVisionCapability({
      provider: entry.provider,
      model: entry.model,
      overrides,
      customKind: customKindsById?.get?.(entry.model) || null,
    });
    if (!vision) return;
    if (!(await allowed(entry))) return;
    out.push(key);
  };
  // Pass 1: same provider first (the most useful suggestions).
  for (const entry of entries) {
    if (entry?.provider === provider) await consider(entry);
    if (out.length >= limit) return out;
  }
  // Pass 2: any provider.
  for (const entry of entries) {
    if (entry?.provider === provider) continue;
    await consider(entry);
    if (out.length >= limit) return out;
  }
  return out;
}
