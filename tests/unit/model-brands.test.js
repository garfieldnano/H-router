// Pure-logic tests for model rebranding + applyLive (plan #2).
// No DB — imports the shared util directly.
import { describe, it, expect } from "vitest";
import {
  BRAND_OWNER,
  LIVE_INJECTED_FLAG,
  LIVE_PROMPT_REDACTED,
  applyLivePromptToMessages,
  applyLivePromptToBody,
  applyModelBrands,
  removePromptSegment,
  sanitizeLivePromptFromBody,
  systemTextOf,
} from "../../src/shared/utils/brandModel.js";

const PROMPT = "You are a terse assistant. Answer in Indonesian.";

describe("applyLivePromptToMessages", () => {
  const user = [{ role: "user", content: "hello" }];

  it("prepend inserts a flagged system message at index 0", () => {
    const out = applyLivePromptToMessages(user, PROMPT, "prepend");
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ role: "system", content: PROMPT });
    expect(out[1]).toBe(user[0]);
  });

  it("prepend keeps the user's own system message after the injected one", () => {
    const msgs = [{ role: "system", content: "Be nice." }, ...user];
    const out = applyLivePromptToMessages(msgs, PROMPT, "prepend");
    expect(out).toHaveLength(3);
    expect(out[0].content).toBe(PROMPT);
    expect(out[1].content).toBe("Be nice.");
  });

  it("replace swaps the first system message content (flagged)", () => {
    const msgs = [{ role: "system", content: "Be nice." }, ...user];
    const out = applyLivePromptToMessages(msgs, PROMPT, "replace");
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ role: "system", content: PROMPT });
    expect(out[1]).toBe(user[0]);
  });

  it("replace inserts at 0 when there is no system message", () => {
    const out = applyLivePromptToMessages(user, PROMPT, "replace");
    expect(out[0]).toEqual({ role: "system", content: PROMPT });
  });

  it("append merges into the existing system message with a separator", () => {
    const msgs = [{ role: "system", content: "Be nice." }, ...user];
    const out = applyLivePromptToMessages(msgs, PROMPT, "append");
    expect(out).toHaveLength(2);
    expect(out[0].content).toBe(`Be nice.\n\n${PROMPT}`);
    expect(Object.keys(out[0]).sort()).toEqual(["content", "role"]); // wire-clean: no marker keys
  });

  it("append inserts at 0 when there is no system message", () => {
    const out = applyLivePromptToMessages(user, PROMPT, "append");
    expect(out[0].content).toBe(PROMPT);
  });

  it("never mutates the input array or messages", () => {
    const msgs = [{ role: "system", content: "Be nice." }, { role: "user", content: "hi" }];
    const snapshot = JSON.stringify(msgs);
    applyLivePromptToMessages(msgs, PROMPT, "append");
    applyLivePromptToMessages(msgs, PROMPT, "replace");
    expect(JSON.stringify(msgs)).toBe(snapshot);
  });

  it("append on array content adds a text part instead of stringifying", () => {
    const msgs = [{ role: "system", content: [{ type: "text", text: "Be nice." }] }, ...user];
    const out = applyLivePromptToMessages(msgs, PROMPT, "append");
    expect(out[0].content).toEqual([
      { type: "text", text: "Be nice." },
      { type: "text", text: PROMPT },
    ]);
  });
});

describe("applyLivePromptToBody", () => {
  it("openai: injects into messages[]", () => {
    const { body, injected } = applyLivePromptToBody(
      { model: "x/y", messages: [{ role: "user", content: "hi" }] }, "openai", PROMPT, "prepend"
    );
    expect(injected).toBe(true);
    expect(body.messages[0]).toEqual({ role: "system", content: PROMPT });
  });

  it("claude: prepends to the top-level system string", () => {
    const { body, injected } = applyLivePromptToBody(
      { model: "x/y", system: "Be nice.", messages: [{ role: "user", content: "hi" }] }, "claude", PROMPT, "prepend"
    );
    expect(injected).toBe(true);
    expect(body.system).toBe(`${PROMPT}\n\nBe nice.`);
    expect(body.messages).toHaveLength(1);
  });

  it("claude: replace swaps the system blocks", () => {
    const { body } = applyLivePromptToBody(
      { model: "x/y", system: [{ type: "text", text: "Be nice." }], messages: [] }, "claude", PROMPT, "replace"
    );
    expect(body.system).toEqual([{ type: "text", text: PROMPT }]);
  });

  it("gemini: writes systemInstruction parts", () => {
    const { body, injected } = applyLivePromptToBody(
      { model: "x/y", contents: [{ role: "user", parts: [{ text: "hi" }] }] }, "gemini", PROMPT, "prepend"
    );
    expect(injected).toBe(true);
    expect(body.systemInstruction.parts).toEqual([{ text: PROMPT }]);
  });

  it("gemini: append merges into the existing instruction", () => {
    const { body } = applyLivePromptToBody(
      { model: "x/y", systemInstruction: { role: "user", parts: [{ text: "Be nice." }] } }, "gemini", PROMPT, "append"
    );
    expect(body.systemInstruction.parts).toEqual([{ text: `Be nice.\n\n${PROMPT}` }]);
  });

  it("antigravity: injects into the request envelope", () => {
    const { body, injected } = applyLivePromptToBody(
      { request: { contents: [] } }, "antigravity", PROMPT, "prepend"
    );
    expect(injected).toBe(true);
    expect(body.request.systemInstruction.parts).toEqual([{ text: PROMPT }]);
  });

  it("openai-responses: writes instructions", () => {
    const { body, injected } = applyLivePromptToBody(
      { model: "x/y", instructions: "Be nice.", input: [{ role: "user", content: "hi" }] },
      "openai-responses", PROMPT, "replace"
    );
    expect(injected).toBe(true);
    expect(body.instructions).toBe(PROMPT);
  });

  it("openai-responses: writes instructions when the field is absent", () => {
    const { body } = applyLivePromptToBody(
      { model: "x/y", input: [{ role: "user", content: "hi" }] }, "openai-responses", PROMPT, "prepend"
    );
    // `instructions` is the canonical system slot for Responses bodies —
    // the translator extracts it into the system message downstream.
    expect(body.instructions).toBe(PROMPT);
    expect(body.input).toEqual([{ role: "user", content: "hi" }]);
  });

  it("openai-responses: falls back to an input system item when instructions is not a string", () => {
    const { body } = applyLivePromptToBody(
      { model: "x/y", instructions: null, input: [{ role: "user", content: "hi" }] }, "openai-responses", PROMPT, "prepend"
    );
    expect(body.input[0]).toEqual({ role: "system", content: PROMPT });
  });

  it("no-op (not injected) when the body has no messages", () => {
    const { injected } = applyLivePromptToBody({ model: "x/y" }, "openai", PROMPT, "prepend");
    expect(injected).toBe(false);
  });

  it("never mutates the input body", () => {
    const body = { model: "x/y", messages: [{ role: "user", content: "hi" }] };
    const snapshot = JSON.stringify(body);
    applyLivePromptToBody(body, "openai", PROMPT, "prepend");
    expect(JSON.stringify(body)).toBe(snapshot);
  });
});

describe("applyModelBrands", () => {
  const aliasMap = { codebuddy: "codebuddy", oc: "opencode", kimi: "kimi" };
  const brands = [
    { brandModelId: "h-router/ultra", upstreamProvider: "codebuddy", upstreamModel: "claude-sonnet-4", displayName: "Ultra", isActive: true },
    { brandModelId: "h-router/ultra-pro", upstreamProvider: "codebuddy", upstreamModel: "claude-sonnet-4", displayName: "Ultra Pro", isActive: true },
    { brandModelId: "h-router/dead", upstreamProvider: "kimi", upstreamModel: "kimi-k2", displayName: "Dead", isActive: false },
  ];
  const list = [
    { id: "codebuddy/claude-sonnet-4", object: "model", owned_by: "codebuddy", capabilities: { tools: true }, context_length: 200000 },
    { id: "kimi/kimi-k2", object: "model", owned_by: "kimi" },
    { id: "my-combo", object: "model", owned_by: "combo" },
  ];

  it("replaces a branded upstream entry with one brand entry per brand", () => {
    const out = applyModelBrands(list, brands, aliasMap);
    expect(out.map((e) => e.id)).toEqual(["h-router/ultra", "h-router/ultra-pro", "kimi/kimi-k2", "my-combo"]);
    expect(out[0].owned_by).toBe(BRAND_OWNER);
    expect(out[0].display_name).toBe("Ultra");
    expect(out[1].display_name).toBe("Ultra Pro");
  });

  it("carries capabilities and token limits from the upstream entry", () => {
    const out = applyModelBrands(list, brands, aliasMap);
    expect(out[0].capabilities).toEqual({ tools: true });
    expect(out[0].context_length).toBe(200000);
  });

  it("inactive brands are hidden and the upstream entry stays", () => {
    const out = applyModelBrands(list, brands, aliasMap);
    expect(out.some((e) => e.id === "h-router/dead")).toBe(false);
    expect(out.some((e) => e.id === "kimi/kimi-k2")).toBe(true);
  });

  it("combo entries pass through untouched", () => {
    const out = applyModelBrands(list, brands, aliasMap);
    expect(out.find((e) => e.id === "my-combo").owned_by).toBe("combo");
  });

  it("no brands → the list is returned unchanged", () => {
    expect(applyModelBrands(list, [], aliasMap)).toBe(list);
    expect(applyModelBrands(list, null, aliasMap)).toBe(list);
  });

  it("matches by provider id, not by list alias", () => {
    // Entry alias "oc" maps to provider "opencode"; a brand for
    // opencode/gpt-5 must match it even though the id says "oc/gpt-5".
    const out = applyModelBrands(
      [{ id: "oc/gpt-5", object: "model", owned_by: "oc" }],
      [{ brandModelId: "h-router/g5", upstreamProvider: "opencode", upstreamModel: "gpt-5", displayName: "G5", isActive: true }],
      aliasMap
    );
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("h-router/g5");
    expect(out[0].owned_by).toBe(BRAND_OWNER);
  });
});

import { buildRequestDetail } from "../../open-sse/handlers/chatCore/requestDetail.js";

describe("buildRequestDetail live-prompt marking", () => {
  const base = {
    provider: "kimi",
    model: "kimi-k3",
    request: { messages: [{ role: "system", content: PROMPT }, { role: "user", content: "hi" }], model: "kimi/kimi-k3", stream: false },
    providerRequest: { messages: [{ role: "system", content: PROMPT }, { role: "user", content: "hi" }], model: "kimi-k3" },
    status: "success",
  };

  it("redacts the prompt from request + providerRequest and sets live_injected", () => {
    const out = buildRequestDetail({ ...base, livePromptText: PROMPT });
    expect(out.live_injected).toBe(true);
    expect(out.request.messages[0].content).toBe(LIVE_PROMPT_REDACTED);
    expect(out.providerRequest.messages[0].content).toBe(LIVE_PROMPT_REDACTED);
    expect(JSON.stringify(out)).not.toContain(PROMPT);
  });

  it("no live prompt → no marker, bodies untouched", () => {
    const out = buildRequestDetail(base);
    expect("live_injected" in out).toBe(false);
    expect(out.request.messages[0].content).toBe(PROMPT);
  });
});

describe("removePromptSegment / sanitizeLivePromptFromBody", () => {
  it("whole-text prompt → placeholder", () => {
    expect(removePromptSegment(PROMPT, PROMPT)).toBe(LIVE_PROMPT_REDACTED);
  });

  it("prompt as one segment among others → only that segment goes", () => {
    expect(removePromptSegment(`Be nice.\n\n${PROMPT}\n\nBe brief.`, PROMPT)).toBe("Be nice.\n\nBe brief.");
  });

  it("unrelated text is untouched", () => {
    expect(removePromptSegment("Be nice.", PROMPT)).toBe("Be nice.");
  });

  it("injected messages are wire-clean: plain { role, content }, no marker keys", () => {
    const out = applyLivePromptToMessages([{ role: "user", content: "hello" }], PROMPT, "prepend");
    expect(Object.keys(out[0]).sort()).toEqual(["content", "role"]);
    expect(JSON.stringify(out)).not.toContain("live_injected");
  });

  it("sanitize redacts messages[] and strips a stray live_injected marker", () => {
    const body = {
      model: "x/y",
      messages: [
        { role: "system", content: PROMPT, [LIVE_INJECTED_FLAG]: true },
        { role: "user", content: "hi" },
      ],
    };
    const out = sanitizeLivePromptFromBody(body, PROMPT);
    expect(out.messages[0].content).toBe(LIVE_PROMPT_REDACTED);
    expect("live_injected" in out.messages[0]).toBe(false);
    expect(out.messages[1].content).toBe("hi");
    expect(JSON.stringify(out)).not.toContain(PROMPT);
    // input untouched (deep copy)
    expect(body.messages[0].content).toBe(PROMPT);
  });

  it("sanitize redacts an appended segment but keeps the user's text", () => {
    const out = sanitizeLivePromptFromBody({
      messages: [{ role: "system", content: `Be nice.\n\n${PROMPT}` }, { role: "user", content: "hi" }],
    }, PROMPT);
    expect(out.messages[0].content).toBe("Be nice.");
    expect(JSON.stringify(out)).not.toContain(PROMPT);
  });

  it("sanitize covers Claude system, Gemini instruction, Responses instructions", () => {
    const claude = sanitizeLivePromptFromBody({ system: `${PROMPT}\n\nBe nice.`, messages: [] }, PROMPT);
    expect(claude.system).toBe("Be nice.");
    const gemini = sanitizeLivePromptFromBody({ systemInstruction: { role: "user", parts: [{ text: PROMPT }] } }, PROMPT);
    expect(gemini.systemInstruction.parts[0].text).toBe(LIVE_PROMPT_REDACTED);
    const resp = sanitizeLivePromptFromBody({ instructions: PROMPT, input: [] }, PROMPT);
    expect(resp.instructions).toBe(LIVE_PROMPT_REDACTED);
    const envelope = sanitizeLivePromptFromBody({ request: { systemInstruction: { parts: [{ text: `Be nice.\n\n${PROMPT}` }] } } }, PROMPT);
    expect(envelope.request.systemInstruction.parts[0].text).toBe("Be nice.");
  });

  it("sanitize is a no-op without a prompt text", () => {
    const body = { messages: [{ role: "system", content: "x" }] };
    expect(sanitizeLivePromptFromBody(body, null)).toBe(body);
    expect(sanitizeLivePromptFromBody(body, "")).toBe(body);
  });

  it("systemTextOf handles strings and content parts", () => {
    expect(systemTextOf("hi")).toBe("hi");
    expect(systemTextOf([{ type: "text", text: "a" }, { type: "image_url", image_url: {} }, { type: "text", text: "b" }])).toBe("a\nb");
    expect(systemTextOf(null)).toBe("");
  });
});
