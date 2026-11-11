// RTK (token saver) per-model toggle — plan G9.
//
// The global switch lives in settings.rtkEnabled (default true). Admins can
// override it per model via settings.rtkModelOverrides, a plain object keyed
// by "provider/model" (the same "provider/model" id the gateway puts in
// body.model, e.g. "kimi/k2", "codebuddy/claude-sonnet-4-5"):
//
//   rtkModelOverrides: { "kimi/k2": false, "codebuddy/claude-sonnet-4-5": true }
//
// Resolution rule: a boolean override for the exact model wins; otherwise
// the global rtkEnabled applies. No override = global behavior unchanged.
//
// Keys are normalized to "provider/model" (trimmed, lowercased provider part
// is NOT applied — provider ids are case-sensitive in this codebase, so the
// key must match exactly what the gateway sends).

export const RTK_MODEL_OVERRIDES_MAX_ENTRIES = 200;

// "provider/model" — both parts non-empty, no whitespace, single slash.
const MODEL_KEY_RE = /^[^\s/]+\/[^\s/]+$/;

export function rtkModelKey(provider, model) {
  if (typeof provider !== "string" || typeof model !== "string") return null;
  const key = `${provider.trim()}/${model.trim()}`;
  return MODEL_KEY_RE.test(key) ? key : null;
}

/** Effective RTK flag for one request. */
export function resolveRtkEnabled(settings, provider, model) {
  const globalEnabled = settings?.rtkEnabled !== false;
  const overrides = settings?.rtkModelOverrides;
  if (!overrides || typeof overrides !== "object") return globalEnabled;
  const key = rtkModelKey(provider, model);
  if (!key) return globalEnabled;
  const override = overrides[key];
  return typeof override === "boolean" ? override : globalEnabled;
}

/**
 * Sanitize a user-supplied overrides map (settings PATCH / UI): keep only
 * boolean values under valid "provider/model" keys, drop everything else.
 * Returns a fresh object (never mutates the input).
 */
export function normalizeRtkModelOverrides(value) {
  const out = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, enabled] of Object.entries(value)) {
    if (Object.keys(out).length >= RTK_MODEL_OVERRIDES_MAX_ENTRIES) break;
    if (typeof enabled !== "boolean") continue;
    const cleanKey = typeof key === "string" ? key.trim() : "";
    if (!MODEL_KEY_RE.test(cleanKey)) continue;
    out[cleanKey] = enabled;
  }
  return out;
}

/** Immutable set: returns a new overrides map with one entry added/updated. */
export function setRtkModelOverride(overrides, provider, model, enabled) {
  const key = rtkModelKey(provider, model);
  if (!key || typeof enabled !== "boolean") return normalizeRtkModelOverrides(overrides);
  const next = normalizeRtkModelOverrides(overrides);
  next[key] = enabled;
  return next;
}

/** Immutable delete: returns a new overrides map without the given model. */
export function removeRtkModelOverride(overrides, provider, model) {
  const key = rtkModelKey(provider, model);
  const next = normalizeRtkModelOverrides(overrides);
  if (key) delete next[key];
  return next;
}
