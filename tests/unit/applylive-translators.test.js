// G4 verification (plan #2): a leading system message — the shape the
// applyLive injector produces — must survive translation to every target
// format the gateway speaks, and must survive back-translation from
// Claude / Gemini / Responses source bodies. These tests pin the actual
// behaviour per translator; any failure here is a real applyLive gap,
// not a test artifact.
import { describe, it, expect } from "vitest";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { compressMessages } from "../../open-sse/rtk/index.js";
import "../translator/registerAll.js";

const PROMPT = "LIVE-PROMPT-7f3a: answer tersely, in Indonesian.";
const USER = "What is 2+2?";

function openaiBody(systemText = PROMPT) {
  return {
    model: "probe/model",
    messages: [
      { role: "system", content: systemText },
      { role: "user", content: USER },
    ],
  };
}

describe("G4: leading system message survives translation", () => {
  it("openai → claude: system becomes top-level `system` blocks", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4", openaiBody(), false, null, "claude");
    expect(out).toBeTruthy();
    const sysText = Array.isArray(out.system)
      ? out.system.map((b) => b.text || "").join("\n")
      : String(out.system || "");
    expect(sysText).toContain(PROMPT);
    // User message survives as a user turn.
    expect(JSON.stringify(out.messages || out)).toContain(USER);
  });

  it("openai → gemini: system becomes systemInstruction", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.GEMINI, "gemini-2.5-flash", openaiBody(), false, null, "gemini");
    expect(out).toBeTruthy();
    const instruction = out.systemInstruction || out.request?.systemInstruction;
    const text = Array.isArray(instruction?.parts)
      ? instruction.parts.map((p) => p.text || "").join("\n")
      : String(instruction || "");
    expect(text).toContain(PROMPT);
    expect(JSON.stringify(out)).toContain(USER);
  });

  it("openai → openai-responses: system becomes `instructions`", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "gpt-5", openaiBody(), false, null, "openai");
    expect(out).toBeTruthy();
    const text = typeof out.instructions === "string" ? out.instructions : JSON.stringify(out.input || out);
    expect(text).toContain(PROMPT);
    expect(JSON.stringify(out)).toContain(USER);
  });

  it("openai → openai (identity): messages pass through with the flag", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "gpt-5", openaiBody(), false, null, "openai");
    expect(out).toBeTruthy();
    expect(out.messages?.[0]?.content).toBe(PROMPT);
    expect("live_injected" in (out.messages?.[0] || {})).toBe(false); // wire-clean
    expect(out.messages?.[1]?.content).toBe(USER);
  });

  it("claude → openai: top-level system becomes messages[0]", () => {
    const out = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "gpt-5", {
      model: "probe/model",
      system: PROMPT,
      messages: [{ role: "user", content: USER }],
    }, false, null, "openai");
    expect(out).toBeTruthy();
    const first = out.messages?.[0];
    expect(first?.role).toBe("system");
    expect(String(first?.content || "")).toContain(PROMPT);
    expect(JSON.stringify(out.messages)).toContain(USER);
  });

  it("gemini → openai: systemInstruction becomes messages[0]", () => {
    const out = translateRequest(FORMATS.GEMINI, FORMATS.OPENAI, "gpt-5", {
      model: "probe/model",
      systemInstruction: { role: "user", parts: [{ text: PROMPT }] },
      contents: [{ role: "user", parts: [{ text: USER }] }],
    }, false, null, "openai");
    expect(out).toBeTruthy();
    const first = out.messages?.[0];
    expect(first?.role).toBe("system");
    expect(String(first?.content || "")).toContain(PROMPT);
    expect(JSON.stringify(out.messages)).toContain(USER);
  });

  it("openai-responses → openai: instructions become messages[0]", () => {
    const out = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "gpt-5", {
      model: "probe/model",
      instructions: PROMPT,
      input: [{ role: "user", content: USER }],
    }, false, null, "openai");
    expect(out).toBeTruthy();
    const first = out.messages?.[0];
    expect(first?.role).toBe("system");
    expect(String(first?.content || "")).toContain(PROMPT);
    expect(JSON.stringify(out.messages)).toContain(USER);
  });
});

describe("G4: RTK does not touch the injected system message", () => {
  it("compressMessages leaves a leading system message intact", () => {
    const body = openaiBody();
    const before = JSON.stringify(body.messages);
    const stats = compressMessages(body, true);
    expect(body.messages[0].content).toBe(PROMPT);
    expect("live_injected" in body.messages[0]).toBe(false); // wire-clean
    expect(JSON.stringify(body.messages)).toBe(before);
    expect(stats).toBeTruthy();
  });
});
