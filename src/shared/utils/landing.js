// Pure helpers for the h-router landing page (no DOM, no DB — unit-tested).
import { LANDING_CONFIG } from "@/shared/constants/landing.js";

// Resolve the public base URL the landing advertises. Precedence:
// 1. an operator-pinned NEXT_PUBLIC_HROUTER_BASE_URL (pinnedBaseUrl),
// 2. the request's own public host (x-forwarded-host when behind the
//    Daytona proxy — the proxy rewrites Host to localhost — else host)
//    + scheme (x-forwarded-proto, else http for localhost, https otherwise),
// 3. the built-in default (LANDING_CONFIG.baseUrl, h-router.web.id/v1).
// Pure and unit-tested; the page component supplies the header values.
export function resolvePublicBaseUrl({ host, proto, pinnedBaseUrl } = {}) {
  if (typeof pinnedBaseUrl === "string" && pinnedBaseUrl) return pinnedBaseUrl.replace(/\/+$/, "");
  const h = typeof host === "string" ? host.trim() : "";
  if (!h) return LANDING_CONFIG.baseUrl;
  const scheme =
    typeof proto === "string" && proto
      ? proto.split(",")[0].trim()
      : h.startsWith("localhost") || h.startsWith("127.0.0.1")
        ? "http"
        : "https";
  return `${scheme}://${h}/v1`;
}

// Validate the recent-requests payload: only well-shaped rows pass
// (a timestamp string, a model id, an endpoint path, a status string,
// a finite token count). Anything else is dropped, never rendered.
export function normalizeRecentRequests(value) {
  if (!value || !Array.isArray(value.requests)) return null;
  return value.requests
    .filter(
      (r) =>
        r &&
        typeof r.timestamp === "string" &&
        typeof r.model === "string" &&
        r.model.length > 0 &&
        typeof r.endpoint === "string" &&
        r.endpoint.length > 0 &&
        typeof r.status === "string" &&
        Number.isFinite(r.tokens)
    )
    .map((r) => ({
      timestamp: r.timestamp,
      model: r.model,
      endpoint: r.endpoint,
      status: r.status,
      tokens: r.tokens,
    }));
}

// Relative time for a real request row ("baru saja", "2 mnt lalu",
// "3 jam lalu"). `now` is injectable for tests. Returns "—" for an
// unparseable timestamp, and a date (DD/MM) for anything older than a day.
export function formatRelativeTime(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const diff = Math.max(0, now - t);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "baru saja";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} mnt lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const d = new Date(t);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

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

// Compact token count for the dashboard preview ("0" / "1.2 rb" / "1.23 jt").
// Non-finite input renders as a dash — never an invented number.
export function formatTokenCount(n) {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(2))} jt`;
  if (n >= 1_000) return `${Number((n / 1_000).toFixed(1))} rb`;
  return `${Math.round(n)}`;
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

// Model-family prefix (the part after "/") -> brand name. A model served
// through an aggregator/proxy provider (e.g. coarena) carries the provider's
// name, not the model's real brand — but the model family itself reveals it
// (claude-* is Anthropic, deepseek-* is DeepSeek, gemini-* is Google
// Gemini). Checked after the provider alias and before the owner name, so a
// known provider still wins and an unknown proxy falls through to the real
// brand instead of rendering a fake initial-letter badge for the proxy.
const BRAND_BY_MODEL_PREFIX = [
  ["claude", "Anthropic"],
  ["deepseek", "DeepSeek"],
  ["gemini", "Google Gemini"],
  ["gpt", "OpenAI"],
  ["qwen", "Qwen"],
  ["grok", "xAI"],
  ["mistral", "Mistral"],
  ["llama", "Meta"],
  ["kimi", "Kimi"],
  ["moonshot", "Kimi"],
  ["glm", "GLM"],
  ["minimax", "MiniMax"],
  ["nemotron", "NVIDIA"],
];
function brandNameForModelFamily(modelName) {
  const name = String(modelName || "").toLowerCase();
  for (const [prefix, brand] of BRAND_BY_MODEL_PREFIX) {
    if (name.startsWith(prefix)) return brand;
  }
  return null;
}

// Resolve one model's brand name from its provider alias, then its model
// family, then its owner name. Shared by resolveCatalogBrands (the strip)
// and resolveModelBrand (one catalog row). Returns null when neither
// resolves to a name.
function brandNameForModel({ id, ownedBy } = {}) {
  if (!id || typeof id !== "string") return null;
  const parts = id.split("/");
  const provider = parts[0].toLowerCase();
  const modelName = parts.slice(1).join("/");
  const owner = typeof ownedBy === "string" ? ownedBy.toLowerCase() : "";
  return (
    BRAND_BY_PROVIDER[provider] ||
    brandNameForModelFamily(modelName) ||
    BRAND_BY_OWNER[owner] ||
    (typeof ownedBy === "string" && ownedBy ? ownedBy : null)
  );
}

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
    const name = brandNameForModel(m);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(byName.get(key) || { name, logo: null });
  }
  return out;
}

// Resolve the brand (name + vendored logo) of one model, for a catalog
// row. Returns null when the brand cannot be resolved at all; a brand
// missing from `brands` comes back as a text badge (logo: null).
export function resolveModelBrand({ id, ownedBy, brands } = {}) {
  const name = brandNameForModel({ id, ownedBy });
  if (!name) return null;
  const known = Array.isArray(brands) ? brands : [];
  const found = known.find((b) => String(b.name).toLowerCase() === name.toLowerCase());
  return found || { name, logo: null };
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
