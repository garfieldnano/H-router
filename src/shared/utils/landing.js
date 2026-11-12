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

// Format a measured round-trip (ms) for the status panel. Never invents a
// number: non-finite input renders as a dash.
export function formatLatency(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} dtk`;
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
