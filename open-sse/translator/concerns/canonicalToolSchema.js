// Canonical tool-schema injector (plan #1) — normalizes a request's `tools`
// to the canonical OpenAI function-calling shape before dispatch:
//
//   { type: "function", function: { name, description, parameters } }
//
// Strict OpenAI-compatible validators on free-tier lanes (OpenCode family)
// reject tools that arrive in the wrong shape (Anthropic `input_schema`,
// bare `{name, parameters}`, missing `parameters`) with HTTP 400. The
// translator usually produces the right shape; this is the safety net for
// the shapes it doesn't normalize. Enabled per provider via registry
// `transport.canonicalTools: true`, and only for OpenAI-shaped targets
// (chatCore gates on the target format — Claude/Responses targets keep
// their own tool shape).
//
// Fail-open: any unexpected input returns the tools unchanged.

const EMPTY_SCHEMA = { type: "object", properties: {} };

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function normalizeParameters(params) {
  if (!isPlainObject(params)) return { ...EMPTY_SCHEMA };
  const out = { ...params };
  if (typeof out.type !== "string" || !out.type) out.type = "object";
  if (!isPlainObject(out.properties)) out.properties = {};
  return out;
}

// Extract { name, description, parameters } from one tool in any known
// shape. Returns null when the tool carries no usable name.
function extractFunction(tool) {
  if (!isPlainObject(tool)) return null;
  const fn = isPlainObject(tool.function) ? tool.function : null;
  if (fn) {
    const name = typeof fn.name === "string" ? fn.name.trim() : "";
    if (!name) return null;
    return {
      ...fn,
      name,
      description: typeof fn.description === "string" ? fn.description : "",
      parameters: normalizeParameters(fn.parameters),
    };
  }
  const name = typeof tool.name === "string" ? tool.name.trim() : "";
  if (!name) return null;
  const params = tool.parameters ?? tool.input_schema ?? tool.inputSchema ?? tool.schema;
  return {
    name,
    description: typeof tool.description === "string" ? tool.description : "",
    parameters: normalizeParameters(params),
  };
}

export function canonicalizeTools(tools) {
  if (!Array.isArray(tools)) return tools;
  try {
    const seen = new Set();
    const out = [];
    for (const tool of tools) {
      const fn = extractFunction(tool);
      if (!fn || seen.has(fn.name)) continue; // drop nameless + duplicates (first wins)
      seen.add(fn.name);
      out.push({ type: "function", function: fn });
    }
    return out;
  } catch {
    return tools;
  }
}
