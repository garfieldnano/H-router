// Conversation turn extraction (plan G7) — pure-logic tests, no DB.
import { describe, it, expect } from "vitest";
import {
  extractMessageText,
  extractAssistantReply,
  extractConversationTurns,
  MAX_TURN_CHARS,
} from "../../src/shared/utils/conversations.js";

const LIVE_PLACEHOLDER = "[live system prompt injected — content hidden]";

describe("extractMessageText", () => {
  it("passes strings through", () => {
    expect(extractMessageText("hello")).toBe("hello");
  });

  it("joins text blocks, notes image + tool blocks", () => {
    const out = extractMessageText([
      { type: "text", text: "look" },
      { type: "image_url", image_url: { url: "data:..." } },
      { type: "tool_use", name: "search" },
    ]);
    expect(out).toContain("look");
    expect(out).toContain("[gambar]");
    expect(out).toContain("[tool: search]");
  });

  it("returns empty for null/unknown shapes", () => {
    expect(extractMessageText(null)).toBe("");
    expect(extractMessageText(42)).toBe("");
    expect(extractMessageText([{ type: "unknown-thing" }])).toBe("[unknown-thing]");
  });
});

describe("extractAssistantReply", () => {
  it("reads the normalized { content } shape", () => {
    expect(extractAssistantReply({ content: "hi there" })).toBe("hi there");
  });

  it("ignores the streaming placeholder", () => {
    expect(extractAssistantReply({ content: "[Streaming in progress...]" })).toBe("");
    expect(extractAssistantReply({ content: "[Empty streaming response]" })).toBe("");
  });

  it("reads OpenAI choices[0].message", () => {
    expect(
      extractAssistantReply({ choices: [{ message: { role: "assistant", content: "answer" } }] })
    ).toBe("answer");
  });

  it("reads Claude-style content blocks", () => {
    expect(
      extractAssistantReply({ content: [{ type: "text", text: "claude says" }] })
    ).toBe("claude says");
  });

  it("reads Gemini candidates parts", () => {
    expect(
      extractAssistantReply({ candidates: [{ content: { parts: [{ text: "gemini says" }] } }] })
    ).toBe("gemini says");
  });

  it("reads error bodies", () => {
    expect(extractAssistantReply({ error: { message: "boom" } })).toBe("Error: boom");
  });
});

describe("extractConversationTurns", () => {
  const base = {
    id: "d-1",
    provider: "kimi",
    model: "kimi-k3",
    status: "success",
    request: {
      messages: [
        { role: "system", content: LIVE_PLACEHOLDER },
        { role: "user", content: "apa kabar?" },
      ],
    },
    response: { content: "Baik, terima kasih." },
  };

  it("keeps the live-prompt placeholder as a system turn (never the prompt text)", () => {
    const { turns, liveInjected } = extractConversationTurns({ ...base, live_injected: true });
    expect(liveInjected).toBe(true);
    expect(turns[0]).toEqual(
      expect.objectContaining({ role: "system", content: LIVE_PLACEHOLDER })
    );
    expect(turns[1].content).toBe("apa kabar?");
    expect(turns[2].content).toBe("Baik, terima kasih.");
    expect(JSON.stringify(turns)).not.toContain("You are a terse assistant");
  });

  it("does not duplicate the reply when the request already ends with it", () => {
    const detail = {
      request: { messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }] },
      response: { content: "hello" },
    };
    const { turns } = extractConversationTurns(detail);
    expect(turns.filter((t) => t.role === "assistant")).toHaveLength(1);
  });

  it("keeps tool calls and tool results as their own turns", () => {
    const detail = {
      request: {
        messages: [
          { role: "user", content: "search the web" },
          { role: "assistant", content: "", tool_calls: [{ type: "function", function: { name: "web_search" } }] },
          { role: "tool", content: "result text" },
        ],
      },
      response: { content: "Here it is." },
    };
    const { turns } = extractConversationTurns(detail);
    expect(turns.map((t) => t.kind)).toEqual(["user", "tool", "tool", "assistant"]);
    expect(turns[1].content).toContain("web_search");
  });

  it("truncates very long turns and flags it", () => {
    const long = "x".repeat(MAX_TURN_CHARS + 100);
    const { turns } = extractConversationTurns({
      request: { messages: [{ role: "user", content: long }] },
      response: {},
    });
    expect(turns).toHaveLength(1);
    expect(turns[0].truncated).toBe(true);
    expect(turns[0].content.length).toBeLessThan(long.length);
  });

  it("returns no turns for missing/empty stored bodies", () => {
    expect(extractConversationTurns({})).toEqual({ turns: [], liveInjected: false });
    expect(extractConversationTurns({ request: { messages: "not-an-array" } }).turns).toEqual([]);
  });
});
