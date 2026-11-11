// Pure helpers for model rebranding + applyLive (plan #2).
// No DB, no I/O — safe to import from unit tests and from both the
// Next.js routes and the open-sse engine.

export const BRAND_OWNER = "h-router";

// Marker for a request that had a live prompt injected. It lives in
// INTERNAL metadata only (the stored request detail) — it is NEVER
// attached to a message object, so it can never leak to an upstream
// provider (strict upstreams may reject unknown message keys) or to
// the client dashboard. The prompt text itself must never be stored
// in request details or request logs.
export const LIVE_INJECTED_FLAG = "live_injected";
export const LIVE_PROMPT_REDACTED = "[live system prompt injected — content hidden]";
export const LIVE_PROMPT_SEP = "\n\n";

const SYSTEM_ROLES = new Set(["system", "developer"]);

// Plain text out of a message content that may be a string or an array
// of content parts ({ type: "text", text }).
export function systemTextOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n");
  }
  return "";
}

// Remove the live prompt from a text that may hold it as a whole or as
// one "\n\n"-delimited segment (prepend/append merge it into the user's
// own system text). Returns the redaction placeholder when nothing is
// left; returns the input unchanged when the prompt is not in it.
export function removePromptSegment(text, prompt) {
  if (typeof text !== "string" || !text || !prompt) return text;
  if (text === prompt) return LIVE_PROMPT_REDACTED;
  const parts = text.split(LIVE_PROMPT_SEP).filter((seg) => seg !== prompt);
  if (parts.length === 0) return LIVE_PROMPT_REDACTED;
  if (parts.length === text.split(LIVE_PROMPT_SEP).length) return text;
  return parts.join(LIVE_PROMPT_SEP);
}

function withPromptAppended(current, prompt) {
  if (!current) return prompt;
  return `${current}${LIVE_PROMPT_SEP}${prompt}`;
}

function withPromptPrepended(current, prompt) {
  if (!current) return prompt;
  return `${prompt}${LIVE_PROMPT_SEP}${current}`;
}

// Apply a live prompt to an OpenAI-style messages[] array (pure — never
// mutates the input). Modes:
//   prepend — a new system message at index 0 (the user's own system
//             message, if any, stays after it);
//   replace — the first system message's content becomes the prompt
//             (inserted at 0 when there is none);
//   append  — the prompt is appended to the first system message's
//             content (inserted at 0 when there is none).
// The injected message is a plain { role, content } pair — no marker
// keys on the wire: it travels to the upstream exactly like a client
// system message, and the injection is recorded only in internal
// metadata (see LIVE_INJECTED_FLAG) by the caller.
export function applyLivePromptToMessages(messages, prompt, mode = "prepend") {
  const arr = Array.isArray(messages) ? messages : [];
  const sysIdx = arr.findIndex((m) => m && m.role === "system");
  const flagged = { role: "system", content: prompt };

  if (mode === "replace") {
    if (sysIdx < 0) return [flagged, ...arr];
    return arr.map((m, i) => (i === sysIdx ? flagged : m));
  }
  if (mode === "append") {
    if (sysIdx < 0) return [flagged, ...arr];
    return arr.map((m, i) => {
      if (i !== sysIdx) return m;
      const current = systemTextOf(m.content);
      const next = withPromptAppended(current, prompt);
      // Keep the original content shape: string stays a string, parts
      // arrays gain a trailing text part.
      if (Array.isArray(m.content)) {
        return { ...m, content: [...m.content, { type: "text", text: prompt }] };
      }
      return { ...m, content: next };
    });
  }
  // prepend (default)
  return [flagged, ...arr];
}

// String-level prompt application for the dedicated system fields
// (Claude `system`, Responses `instructions`).
function applyPromptToSystemText(current, prompt, mode) {
  if (mode === "replace") return prompt;
  if (mode === "append") return withPromptAppended(current || "", prompt);
  return withPromptPrepended(current || "", prompt);
}

function applyPromptToClaudeSystem(system, prompt, mode) {
  if (Array.isArray(system)) {
    const blocks = system.filter((b) => b && typeof b.text === "string");
    const current = blocks.map((b) => b.text).join("\n");
    if (mode === "replace") return [{ type: "text", text: prompt }];
    if (mode === "append") {
      if (!current) return [{ type: "text", text: prompt }];
      return [...system, { type: "text", text: prompt }];
    }
    // prepend: a leading text block; keep the rest untouched.
    return [{ type: "text", text: prompt }, ...system];
  }
  return applyPromptToSystemText(typeof system === "string" ? system : "", prompt, mode);
}

function applyPromptToGeminiInstruction(instruction, prompt, mode) {
  const parts = Array.isArray(instruction?.parts) ? instruction.parts : [];
  const current = parts.filter((p) => p && typeof p.text === "string").map((p) => p.text).join("\n");
  const next = applyPromptToSystemText(current, prompt, mode);
  return { ...(instruction || {}), role: "user", parts: [{ text: next }] };
}

// Apply a live prompt to a request body in its SOURCE format (pure —
// returns a new body; the input is never mutated). Returns
// { body, injected }. Formats handled: OpenAI chat (messages[]), Claude
// (top-level system), Gemini family (systemInstruction, incl. the
// Antigravity request envelope), OpenAI Responses (instructions / input[]).
// Unknown shapes fall back to messages[] when present, otherwise no-op.
export function applyLivePromptToBody(body, format, prompt, mode = "prepend") {
  if (!body || typeof body !== "object" || !prompt) return { body, injected: false };
  const fmt = typeof format === "string" ? format : "openai";

  // Gemini-family targets keep the prompt in systemInstruction.
  if (fmt === "gemini" || fmt === "gemini-cli" || fmt === "antigravity" || fmt === "vertex") {
    if (body.request && typeof body.request === "object") {
      return {
        body: {
          ...body,
          request: {
            ...body.request,
            systemInstruction: applyPromptToGeminiInstruction(body.request.systemInstruction, prompt, mode),
          },
        },
        injected: true,
      };
    }
    return {
      body: { ...body, systemInstruction: applyPromptToGeminiInstruction(body.systemInstruction, prompt, mode) },
      injected: true,
    };
  }

  // Claude keeps it in a dedicated top-level `system` field (a system
  // role inside messages[] is rejected by Anthropic).
  if (fmt === "claude") {
    return {
      body: { ...body, system: applyPromptToClaudeSystem(body.system, prompt, mode) },
      injected: true,
    };
  }

  // OpenAI Responses keeps it in `instructions` (preferred) or as a
  // system item in input[].
  if (fmt === "openai-responses") {
    if (typeof body.instructions === "string" || body.instructions === undefined) {
      return {
        body: { ...body, instructions: applyPromptToSystemText(body.instructions || "", prompt, mode) },
        injected: true,
      };
    }
    if (Array.isArray(body.input)) {
      return {
        body: { ...body, input: applyLivePromptToMessages(body.input, prompt, mode) },
        injected: true,
      };
    }
    return { body, injected: false };
  }

  // OpenAI chat (and anything else with a messages[] array).
  if (Array.isArray(body.messages)) {
    return { body: { ...body, messages: applyLivePromptToMessages(body.messages, prompt, mode) }, injected: true };
  }
  return { body, injected: false };
}

// Rewrite a /v1/models list through the active brand map (pure).
// An upstream entry that has a brand is REPLACED by one brand entry per
// brand (id = brandModelId, owned_by = "h-router"); capabilities and
// token limits ride along from the upstream entry. Entries with no
// brand (incl. combos) pass through unchanged. aliasToProviderId maps a
// list-entry alias (e.g. "codebuddy") to its provider id.
export function applyModelBrands(modelsList, brands, aliasToProviderId = {}) {
  if (!Array.isArray(modelsList)) return modelsList;
  const active = (Array.isArray(brands) ? brands : []).filter((b) => b && b.isActive !== false);
  if (active.length === 0) return modelsList;
  const byUpstream = new Map();
  for (const b of active) {
    if (!b.upstreamProvider || !b.upstreamModel) continue;
    const key = `${b.upstreamProvider}/${b.upstreamModel}`;
    if (!byUpstream.has(key)) byUpstream.set(key, []);
    byUpstream.get(key).push(b);
  }
  if (byUpstream.size === 0) return modelsList;

  const out = [];
  for (const entry of modelsList) {
    if (!entry?.id || typeof entry.id !== "string") { out.push(entry); continue; }
    if (entry.owned_by === "combo") { out.push(entry); continue; }
    const slash = entry.id.indexOf("/");
    if (slash <= 0) { out.push(entry); continue; }
    const alias = entry.id.slice(0, slash);
    const model = entry.id.slice(slash + 1);
    const providerId = aliasToProviderId[alias] || alias;
    const matches = byUpstream.get(`${providerId}/${model}`);
    if (!matches || matches.length === 0) { out.push(entry); continue; }
    for (const brand of matches) {
      const branded = { ...entry, id: brand.brandModelId, owned_by: BRAND_OWNER };
      branded.display_name = brand.displayName || brand.brandModelId;
      out.push(branded);
    }
  }
  return out;
}

// ---- Leak prevention -------------------------------------------------
// Redact the live prompt text out of a request body (deep copy — the
// input is never mutated). Shape-sniffing, mirroring the injector:
// OpenAI messages[], Claude `system`, Gemini `systemInstruction`
// (incl. the Antigravity envelope), Responses `instructions` / `input[]`.
// A message/field that held ONLY the prompt becomes the redaction
// placeholder; a prompt merged into the user's own system text loses
// just its segment. Kiro targets are NOT covered: the kiro translator
// merges the system prompt into the first user turn's content, so the
// text cannot be told apart from user content there (request details
// are admin-only and API-redacted, so the member dashboard is safe
// regardless — see the build log).
function redactSystemText(text, prompt) {
  return removePromptSegment(text, prompt);
}

function redactContentParts(content, prompt) {
  if (typeof content === "string") return redactSystemText(content, prompt);
  if (Array.isArray(content)) {
    return content.map((p) => {
      if (p && typeof p.text === "string") return { ...p, text: redactSystemText(p.text, prompt) };
      return p;
    });
  }
  return content;
}

function redactMessagesArray(arr, prompt) {
  if (!Array.isArray(arr)) return arr;
  return arr.map((m) => {
    if (!m || typeof m !== "object") return m;
    if (!SYSTEM_ROLES.has(m.role)) return m;
    const next = { ...m, content: redactContentParts(m.content, prompt) };
    // Defensive: a stray live_injected marker (client-sent, or from an
    // older build) must not survive into stored records either.
    if (LIVE_INJECTED_FLAG in next) delete next[LIVE_INJECTED_FLAG];
    return next;
  });
}

export function sanitizeLivePromptFromBody(body, promptText) {
  if (!body || typeof body !== "object" || !promptText) return body;
  let clone;
  try {
    clone = JSON.parse(JSON.stringify(body));
  } catch {
    return body;
  }
  if (Array.isArray(clone.messages)) clone.messages = redactMessagesArray(clone.messages, promptText);
  if (clone.system !== undefined) {
    if (typeof clone.system === "string") clone.system = redactSystemText(clone.system, promptText);
    else if (Array.isArray(clone.system)) {
      clone.system = clone.system.map((b) => {
        if (b && typeof b.text === "string") return { ...b, text: redactSystemText(b.text, promptText) };
        return b;
      });
    }
  }
  if (clone.systemInstruction && typeof clone.systemInstruction === "object") {
    if (Array.isArray(clone.systemInstruction.parts)) {
      clone.systemInstruction = {
        ...clone.systemInstruction,
        parts: clone.systemInstruction.parts.map((p) => {
          if (p && typeof p.text === "string") return { ...p, text: redactSystemText(p.text, promptText) };
          return p;
        }),
      };
    }
  }
  if (clone.request && typeof clone.request === "object" && clone.request.systemInstruction) {
    clone.request = sanitizeLivePromptFromBody(clone.request, promptText);
  }
  if (typeof clone.instructions === "string") {
    clone.instructions = redactSystemText(clone.instructions, promptText);
  }
  if (Array.isArray(clone.input)) clone.input = redactMessagesArray(clone.input, promptText);
  if (typeof clone.input === "string" && clone.input === promptText) clone.input = LIVE_PROMPT_REDACTED;
  return clone;
}
