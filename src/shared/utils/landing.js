// Pure helpers for the h-router landing page (no DOM, no DB — unit-tested).

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

// Pick what the catalog shows. Live gateway data wins; the editable
// FALLBACK_MODELS list is used only when the live list is empty
// (unreachable / requireApiKey on / no models). `limit` caps the first page;
// `total` is the full count for the "show all" affordance.
export function resolveCatalogModels({ liveModels, fallbackModels, limit = 12 } = {}) {
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
