// Conversation viewer helpers (plan G7) — pure functions over a stored
// requestDetails record.
//
// The stored request/response bodies already had any injected live prompt
// replaced by the placeholder at save time (buildRequestDetail +
// sanitizeLivePromptFromBody, plan #2), so the turns returned here never
// contain live-prompt text. This extractor never re-introduces prompt
// content: it only reads what is already stored.

export const MAX_TURN_CHARS = 4000;
export const STREAMING_PLACEHOLDER = "[Streaming in progress...]";
export const EMPTY_RESPONSE_PLACEHOLDER = "[Empty streaming response]";

/**
 * Flatten a message `content` value to plain text.
 * Accepts a string, or an array of content blocks (OpenAI/Claude style:
 * { type: "text", text }, { type: "image_url", ... }, tool blocks, ...).
 * Non-text blocks become a short bracketed note so the turn stays readable.
 */
export function extractMessageText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = [];
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      if (typeof block.text === "string" && block.text) {
        parts.push(block.text);
      } else if (block.type === "image_url" || block.type === "image") {
        parts.push("[gambar]");
      } else if (block.type === "tool_use" || block.type === "function") {
        parts.push(`[tool: ${block.name || block.function?.name || "?"}]`);
      } else if (block.type) {
        parts.push(`[${block.type}]`);
      }
    }
    return parts.join("\n");
  }
  if (content && typeof content === "object") {
    if (typeof content.text === "string") return content.text;
  }
  return "";
}

function truncateTurn(text) {
  if (text.length <= MAX_TURN_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_TURN_CHARS) + `… [dipotong, ${text.length - MAX_TURN_CHARS} karakter lagi]`, truncated: true };
}

function pushTurn(turns, role, text, kind) {
  const clean = (text || "").trim();
  if (!clean) return;
  const { text: shown, truncated } = truncateTurn(clean);
  turns.push({ role, kind: kind || role, content: shown, truncated });
}

/**
 * Extract the assistant's reply text from a stored `response` body.
 * Handles OpenAI chat (choices[0].message), OpenAI Responses / Claude
 * (content blocks), Gemini (candidates[0].content.parts), the normalized
 * { content } shape the streaming handler stores, and { error }.
 * Returns "" when there is no usable reply (e.g. the streaming placeholder
 * left behind when a stream was never completed).
 */
export function extractAssistantReply(response) {
  if (!response || typeof response !== "object") return "";
  // Normalized shape stored by the streaming handler on completion.
  if (typeof response.content === "string") {
    if (response.content === STREAMING_PLACEHOLDER || response.content === EMPTY_RESPONSE_PLACEHOLDER) return "";
    return response.content;
  }
  // OpenAI chat completions: choices[0].message.{content, tool_calls}
  const choice = Array.isArray(response.choices) ? response.choices[0] : null;
  if (choice?.message) {
    const text = extractMessageText(choice.message.content);
    if (text) return text;
    if (Array.isArray(choice.message.tool_calls) && choice.message.tool_calls.length) {
      return choice.message.tool_calls
        .map((tc) => `[tool call: ${tc.function?.name || tc.type || "?"}]`)
        .join("\n");
    }
  }
  if (typeof choice?.text === "string") return choice.text;
  // Claude / OpenAI Responses: content blocks at top level.
  if (Array.isArray(response.content)) {
    const text = extractMessageText(response.content);
    if (text) return text;
  }
  // Gemini: candidates[0].content.parts[].text
  const candidate = Array.isArray(response.candidates) ? response.candidates[0] : null;
  const parts = candidate?.content?.parts;
  if (Array.isArray(parts)) {
    const text = parts
      .filter((p) => typeof p?.text === "string" && p.text)
      .map((p) => p.text)
      .join("\n");
    if (text) return text;
  }
  if (typeof response.error === "string") return `Error: ${response.error}`;
  if (response.error?.message) return `Error: ${response.error.message}`;
  return "";
}

/**
 * Build the turn list for one stored requestDetails record.
 *
 * Turns come from `request.messages` (the client request as stored —
 * live-prompt text already replaced by the placeholder upstream) plus the
 * assistant reply from `response`. Tool messages are kept as their own
 * turns so tool-call traces stay readable.
 *
 * Returns { turns, liveInjected } where each turn is
 * { role, kind, content, truncated }.
 */
export function extractConversationTurns(detail = {}) {
  const turns = [];
  const messages = Array.isArray(detail?.request?.messages)
    ? detail.request.messages
    : [];

  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const role = typeof msg.role === "string" ? msg.role : "unknown";
    if (role === "tool") {
      const text = extractMessageText(msg.content);
      pushTurn(turns, role, text || `[tool result]`, "tool");
      continue;
    }
    const text = extractMessageText(msg.content);
    if (text) {
      pushTurn(turns, role, text, role);
    }
    if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
      pushTurn(
        turns,
        "assistant",
        msg.tool_calls.map((tc) => `[tool call: ${tc.function?.name || tc.type || "?"}]`).join("\n"),
        "tool"
      );
    }
  }

  // Assistant reply (stored response). Skip it when the request messages
  // already end with an identical assistant turn (non-streaming saves
  // sometimes carry the reply in both places).
  const reply = extractAssistantReply(detail?.response);
  if (reply) {
    const last = turns[turns.length - 1];
    if (!(last && last.role === "assistant" && last.content === reply.slice(0, MAX_TURN_CHARS))) {
      pushTurn(turns, "assistant", reply, "assistant");
    }
  }

  return { turns, liveInjected: detail?.live_injected === true };
}
