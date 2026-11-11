// Playground helpers (plan G7) — pure functions for the admin-only
// model playground. The playground never calls the gateway from the
// browser: POST /api/playground/chat builds a synthetic request and runs
// it through the same handleChat() the /v1 route uses, so RPM / IP-cap /
// key-access gates and usage recording apply exactly like a real client.

/**
 * Validate + normalize a playground send. Returns
 * { ok: true, body } or { ok: false, error }.
 * The gateway always runs non-streaming here (stream: false) so the page
 * can render one complete answer with its usage.
 */
export function buildPlaygroundBody({ model, messages, temperature, maxTokens }) {
  if (typeof model !== "string" || !model.trim()) {
    return { ok: false, error: "Pilih model dulu" };
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, error: "Pesan kosong — tulis prompt dulu" };
  }
  const clean = [];
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    if (m.role !== "user" && m.role !== "system" && m.role !== "assistant") continue;
    const content = typeof m.content === "string" ? m.content : "";
    if (!content.trim() && m.role === "user") continue;
    clean.push({ role: m.role, content });
  }
  if (!clean.some((m) => m.role === "user")) {
    return { ok: false, error: "Minimal satu pesan user" };
  }
  const body = { model: model.trim(), messages: clean, stream: false };
  if (temperature !== undefined && temperature !== null && temperature !== "") {
    const t = Number(temperature);
    if (!Number.isFinite(t) || t < 0 || t > 2) {
      return { ok: false, error: "Temperature harus 0–2" };
    }
    body.temperature = t;
  }
  if (maxTokens !== undefined && maxTokens !== null && maxTokens !== "") {
    const n = Number(maxTokens);
    if (!Number.isInteger(n) || n < 1) {
      return { ok: false, error: "Max tokens harus bilangan bulat ≥ 1" };
    }
    body.max_tokens = n;
  }
  return { ok: true, body };
}

/**
 * Pull { content, usage, finishReason, model } out of a gateway chat
 * response (OpenAI chat format). Returns { error } for error bodies.
 */
export function parsePlaygroundResponse(json) {
  if (!json || typeof json !== "object") return { error: "Respons gateway kosong" };
  if (json.error) {
    const msg = typeof json.error === "string" ? json.error : json.error.message || "Gateway error";
    return { error: msg };
  }
  const choice = Array.isArray(json.choices) ? json.choices[0] : null;
  const message = choice?.message;
  let content = "";
  if (typeof message?.content === "string") content = message.content;
  else if (typeof choice?.text === "string") content = choice.text;
  const u = json.usage || {};
  const usage = {
    promptTokens: u.prompt_tokens ?? u.input_tokens ?? 0,
    completionTokens: u.completion_tokens ?? u.output_tokens ?? 0,
    totalTokens: u.total_tokens ?? (u.prompt_tokens ?? u.input_tokens ?? 0) + (u.completion_tokens ?? u.output_tokens ?? 0),
  };
  return {
    content,
    usage,
    finishReason: choice?.finish_reason || null,
    model: json.model || null,
  };
}

/**
 * Pick the API key a playground call runs as: the admin's chosen key if
 * it is still active, otherwise the first active key. Returns null when
 * the gateway has no active API key at all (the page then tells the admin
 * to create one on Endpoint & Key first).
 */
export function pickPlaygroundApiKey(keys, preferredId) {
  const list = (keys || []).filter((k) => k && k.isActive !== false && k.isActive !== 0 && typeof k.key === "string" && k.key);
  if (!list.length) return null;
  if (preferredId) {
    const hit = list.find((k) => k.id === preferredId);
    if (hit) return hit;
  }
  return list[0];
}
