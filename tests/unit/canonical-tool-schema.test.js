// Canonical tool-schema injector (plan #1): normalizes every known tool
// shape to the canonical OpenAI function-calling shape. Pure, fail-open.
import { describe, it, expect } from "vitest";
import { canonicalizeTools } from "open-sse/translator/concerns/canonicalToolSchema.js";

describe("canonicalizeTools", () => {
  it("passes canonical OpenAI tools through (fills missing parameters)", () => {
    const tools = [
      { type: "function", function: { name: "search", description: "web search", parameters: { type: "object", properties: { q: { type: "string" } } } } },
      { type: "function", function: { name: "noop", description: "no params" } },
    ];
    const out = canonicalizeTools(tools);
    expect(out[0].function.parameters.properties.q.type).toBe("string");
    expect(out[1].function.parameters).toEqual({ type: "object", properties: {} });
  });

  it("converts Anthropic input_schema → parameters", () => {
    const out = canonicalizeTools([
      { name: "read", description: "read a file", input_schema: { type: "object", properties: { path: { type: "string" } } } },
    ]);
    expect(out).toEqual([
      { type: "function", function: { name: "read", description: "read a file", parameters: { type: "object", properties: { path: { type: "string" } } } } },
    ]);
  });

  it("wraps bare {name, parameters} and adds the function type", () => {
    const out = canonicalizeTools([
      { name: "calc", parameters: { type: "object", properties: {} } },
      { function: { name: "ping", description: "ping" } },
    ]);
    expect(out[0]).toEqual({ type: "function", function: { name: "calc", description: "", parameters: { type: "object", properties: {} } } });
    expect(out[1].type).toBe("function");
    expect(out[1].function.name).toBe("ping");
  });

  it("accepts inputSchema alias and preserves extra function fields", () => {
    const out = canonicalizeTools([
      { name: "strict_fn", inputSchema: { type: "object", properties: {} }, description: "d" },
      { type: "function", function: { name: "s", strict: true, parameters: { type: "object", properties: {} } } },
    ]);
    expect(out[0].function.parameters).toEqual({ type: "object", properties: {} });
    expect(out[1].function.strict).toBe(true);
  });

  it("drops nameless tools and dedupes by name (first wins)", () => {
    const out = canonicalizeTools([
      { name: "a", description: "first" },
      { description: "no name at all" },
      { name: "a", description: "second" },
      { type: "function", function: { name: "b" } },
      { type: "function", function: { name: "b" } },
    ]);
    expect(out.map((t) => t.function.name)).toEqual(["a", "b"]);
    expect(out[0].function.description).toBe("first");
  });

  it("adds type: object to schemaless parameters objects", () => {
    const out = canonicalizeTools([
      { name: "f", parameters: { properties: { x: { type: "number" } } } },
    ]);
    expect(out[0].function.parameters).toEqual({ properties: { x: { type: "number" } }, type: "object" });
  });

  it("is fail-open: non-array input returns as-is, garbage never throws", () => {
    expect(canonicalizeTools(null)).toBeNull();
    expect(canonicalizeTools(undefined)).toBeUndefined();
    expect(() => canonicalizeTools([null, 42, "x", { name: "ok" }])).not.toThrow();
    expect(canonicalizeTools([null, 42, "x", { name: "ok" }]).map((t) => t.function.name)).toEqual(["ok"]);
    expect(canonicalizeTools([])).toEqual([]);
  });
});
