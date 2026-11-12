// Pure helpers for the h-router landing page (no DOM, no DB — unit-tested).

// Fetch with a hard timeout. A hung request must never leave the landing
// page stuck on "Memuat…" forever: callers treat a timeout like any other
// failure (fallback catalog / offline status). `fetchFn` is injectable for
// tests and defaults to the global fetch; the timeout's AbortSignal wins
// over any caller-supplied signal.
export async function fetchWithTimeout(url, { timeoutMs = 10000, fetchFn = fetch, ...options } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Normalize a GET /v1/models response body into [{ id, name, ownedBy }].
// Anything malformed yields [] (the caller falls back to FALLBACK_MODELS).
export function normalizeModelsResponse(json) {
  const data = json && Array.isArray(json.data) ? json.data : [];
  const out = [];
  for (const m of data) {
    if (!m || typeof m.id !== "string" || !m.id) continue;
    out.push({
      id: m.id,
      name: typeof m.name === "string" && m.name ? m.name : m.id,
      ownedBy: typeof m.owned_by === "string" ? m.owned_by : "",
    });
  }
  return out;
}

// Pick what the catalog shows. The admin panel's published list wins:
// when GET /api/public/models answers, its list IS the catalog — even when
// it is empty (the admin disabled everything), because falling through to
// the live list would re-publish models the admin just removed. `adminModels`
// must be an array for the admin source to apply; null/undefined means the
// admin endpoint was not reached, so the older sources apply in order:
// live /v1/models data, then the editable FALLBACK_MODELS list. `limit` caps
// the first page; `total` is the full count for the "show all" affordance.
export function resolveCatalogModels({ adminModels, liveModels, fallbackModels, limit = 12 } = {}) {
  if (Array.isArray(adminModels)) {
    return { models: adminModels.slice(0, limit), total: adminModels.length, source: "admin" };
  }
  const live = Array.isArray(liveModels) ? liveModels : [];
  if (live.length > 0) {
    return { models: live.slice(0, limit), total: live.length, source: "live" };
  }
  const fallback = Array.isArray(fallbackModels) ? fallbackModels : [];
  if (fallback.length > 0) {
    return { models: fallback.slice(0, limit), total: fallback.length, source: "fallback" };
  }
  return { models: [], total: 0, source: "empty" };
}

// Restrict the admin-published model list to the admin's landing picks.
// `picked` is the settings.landingModels array (model ids in display order).
// An empty or missing list means no restriction: every model stays. A
// non-empty list keeps only the picked ids that still exist, in the picked
// order (a picked model that was later disabled or removed drops out
// instead of reappearing), with duplicates collapsed.
export function resolvePublishedModels({ models, picked } = {}) {
  const all = Array.isArray(models) ? models : [];
  const ids = Array.isArray(picked) ? picked.filter((id) => typeof id === "string" && id) : [];
  if (ids.length === 0) return all;
  const byId = new Map(all.map((m) => [m.id, m]));
  const out = [];
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const m = byId.get(id);
    if (m) out.push(m);
  }
  return out;
}

// Format a measured round-trip (ms) for the status panel. Never invents a
// number: non-finite input renders as a dash.
export function formatLatency(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} dtk`;
}

// Short latency for the dashboard preview ("1.07s" / "842ms" / "—").
export function formatLatencyShort(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// Deterministic jitter around the measured base latency for the preview
// request log: the same (base, index) always yields the same value, within
// ±60 ms of the base and never below 1 ms. Non-finite input yields null
// (the log renders a dash instead of inventing a number).
export function requestLogLatency(baseMs, index) {
  if (!Number.isFinite(baseMs) || baseMs < 0) return null;
  const jitter = ((Math.floor(index) * 37) % 121) - 60;
  return Math.max(1, Math.round(baseMs + jitter));
}

// Provider alias (the part before "/" in a model id) -> brand name in
// LANDING_BRANDS. The catalog's provider aliases are not the brand names:
// alicode[-intl] serves Qwen, deepseek-web serves DeepSeek, groq serves
// Meta (Llama), moonshot is Kimi, zhipu/zai is GLM.
const BRAND_BY_PROVIDER = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  google: "Google Gemini",
  deepseek: "DeepSeek",
  "deepseek-web": "DeepSeek",
  alicode: "Qwen",
  "alicode-intl": "Qwen",
  qwen: "Qwen",
  kimi: "Kimi",
  moonshot: "Kimi",
  glm: "GLM",
  zhipu: "GLM",
  zai: "GLM",
  xai: "xAI",
  mistral: "Mistral",
  minimax: "MiniMax",
  groq: "Meta",
  meta: "Meta",
  nvidia: "NVIDIA",
};

// The model's own owner name (ownedBy) -> brand name, for when the
// provider alias is unknown but the owner is a known brand.
const BRAND_BY_OWNER = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google Gemini",
  deepseek: "DeepSeek",
  alibaba: "Qwen",
  qwen: "Qwen",
  moonshot: "Kimi",
  kimi: "Kimi",
  zhipu: "GLM",
  "z.ai": "GLM",
  glm: "GLM",
  xai: "xAI",
  mistral: "Mistral",
  minimax: "MiniMax",
  meta: "Meta",
  nvidia: "NVIDIA",
};

// Derive the brand strip from the catalog: distinct brands of the models
// the admin publishes, in first-seen order, capped at `limit`. A brand
// resolves through the provider-alias map, then through the model owner's
// name; a model whose brand cannot be resolved at all is skipped. Brands
// missing from `brands` (the vendored list) still appear as a text badge
// (logo: null) so the strip never hides a published brand.
export function resolveCatalogBrands({ models, brands, limit = 12 } = {}) {
  const list = Array.isArray(models) ? models : [];
  const known = Array.isArray(brands) ? brands : [];
  const byName = new Map(known.map((b) => [String(b.name).toLowerCase(), b]));
  const out = [];
  const seen = new Set();
  for (const m of list) {
    if (out.length >= limit) break;
    if (!m || typeof m.id !== "string" || !m.id) continue;
    const provider = m.id.split("/")[0].toLowerCase();
    const owner = typeof m.ownedBy === "string" ? m.ownedBy.toLowerCase() : "";
    const name =
      BRAND_BY_PROVIDER[provider] ||
      BRAND_BY_OWNER[owner] ||
      (typeof m.ownedBy === "string" && m.ownedBy ? m.ownedBy : null);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(byName.get(key) || { name, logo: null });
  }
  return out;
}

// Code samples for the "Mulai" section. `model` is the first catalog model
// id when known, otherwise a visible placeholder (never a fake model id).
export function buildCodeSamples({ baseUrl, apiKey, model } = {}) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const key = apiKey || "h-router-...";
  const modelId = model || "<id-model>";
  const curl =
    `curl ${base}/chat/completions \\\n` +
    `  -H "Authorization: Bearer ${key}" \\\n` +
    `  -H "Content-Type: application/json" \\\n` +
    `  -d '{\n    "model": "${modelId}",\n    "messages": [{ "role": "user", "content": "halo" }]\n  }'`;
  const python =
    `from openai import OpenAI\n\n` +
    `client = OpenAI(\n    base_url="${base}",\n    api_key="${key}",\n)\n\n` +
    `r = client.chat.completions.create(\n    model="${modelId}",\n    messages=[{"role": "user", "content": "halo"}],\n)\n\n` +
    `print(r.choices[0].message.content)`;
  const node =
    `import OpenAI from "openai";\n\n` +
    `const client = new OpenAI({\n  baseURL: "${base}",\n  apiKey: process.env.HROUTER_KEY || "${key}",\n});\n\n` +
    `const r = await client.chat.completions.create({\n  model: "${modelId}",\n  messages: [{ role: "user", content: "halo" }],\n});\n\n` +
    `console.log(r.choices[0].message.content);`;
  return { curl, python, node };
}
