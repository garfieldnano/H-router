// Playground helpers (plan G7) — pure-logic tests, no DB, no network.
import { describe, it, expect } from "vitest";
import {
  buildPlaygroundBody,
  parsePlaygroundResponse,
  pickPlaygroundApiKey,
} from "../../src/shared/utils/playground.js";

describe("buildPlaygroundBody", () => {
  it("builds a non-streaming body from model + user message", () => {
    const r = buildPlaygroundBody({
      model: "kimi/kimi-k3",
      messages: [{ role: "user", content: "halo" }],
    });
    expect(r).toEqual({
      ok: true,
      body: { model: "kimi/kimi-k3", messages: [{ role: "user", content: "halo" }], stream: false },
    });
  });

  it("keeps an optional system message first, drops empty user messages", () => {
    const r = buildPlaygroundBody({
      model: "m",
      messages: [
        { role: "system", content: "Be nice." },
        { role: "user", content: "  " },
        { role: "user", content: "hi" },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.body.messages).toEqual([
      { role: "system", content: "Be nice." },
      { role: "user", content: "hi" },
    ]);
  });

  it("validates temperature and max_tokens ranges", () => {
    expect(buildPlaygroundBody({ model: "m", messages: [{ role: "user", content: "x" }], temperature: 3 }).ok).toBe(false);
    expect(buildPlaygroundBody({ model: "m", messages: [{ role: "user", content: "x" }], temperature: 0.7 }).ok).toBe(true);
    expect(buildPlaygroundBody({ model: "m", messages: [{ role: "user", content: "x" }], maxTokens: 0 }).ok).toBe(false);
    expect(buildPlaygroundBody({ model: "m", messages: [{ role: "user", content: "x" }], maxTokens: 100 }).ok).toBe(true);
  });

  it("rejects missing model / missing user message", () => {
    expect(buildPlaygroundBody({ model: "", messages: [{ role: "user", content: "x" }] }).ok).toBe(false);
    expect(buildPlaygroundBody({ model: "m", messages: [] }).ok).toBe(false);
    expect(buildPlaygroundBody({ model: "m", messages: [{ role: "system", content: "only system" }] }).ok).toBe(false);
  });
});

describe("parsePlaygroundResponse", () => {
  it("extracts content + usage from an OpenAI chat response", () => {
    const out = parsePlaygroundResponse({
      model: "kimi-k3",
      choices: [{ message: { role: "assistant", content: "halo!" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    expect(out).toEqual({
      content: "halo!",
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      finishReason: "stop",
      model: "kimi-k3",
    });
  });

  it("reads input/output token names too", () => {
    const out = parsePlaygroundResponse({
      choices: [{ message: { content: "x" } }],
      usage: { input_tokens: 7, output_tokens: 3 },
    });
    expect(out.usage).toEqual({ promptTokens: 7, completionTokens: 3, totalTokens: 10 });
  });

  it("surfaces gateway errors", () => {
    expect(parsePlaygroundResponse({ error: { message: "boom" } })).toEqual({ error: "boom" });
    expect(parsePlaygroundResponse(null)).toEqual({ error: "Respons gateway kosong" });
  });
});

describe("pickPlaygroundApiKey", () => {
  const keys = [
    { id: "k1", key: "h-router-aaa", isActive: true },
    { id: "k2", key: "h-router-bbb", isActive: false },
    { id: "k3", key: "h-router-ccc", isActive: true },
  ];

  it("prefers the admin-chosen active key", () => {
    expect(pickPlaygroundApiKey(keys, "k3").id).toBe("k3");
  });

  it("falls back to the first active key", () => {
    expect(pickPlaygroundApiKey(keys, "k2").id).toBe("k1");
    expect(pickPlaygroundApiKey(keys, undefined).id).toBe("k1");
  });

  it("returns null when no active key exists", () => {
    expect(pickPlaygroundApiKey([], undefined)).toBeNull();
    expect(pickPlaygroundApiKey([{ id: "k2", key: "x", isActive: false }], undefined)).toBeNull();
  });
});
