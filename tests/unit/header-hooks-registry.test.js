// Registry-driven header hooks (plan #1): the hook SELECTION moved from
// hardcoded auth.hooks to transport.headerHooks, and the IMPLEMENTATIONS
// moved from DefaultExecutor into executors/headerHooks.js. Behavior must
// be identical: the same headers, for the same providers.
import { describe, it, expect } from "vitest";
import { PROVIDERS } from "open-sse/config/providers.js";
import { DefaultExecutor } from "open-sse/executors/default.js";
import { applyHeaderHooks, HEADER_HOOKS } from "open-sse/executors/headerHooks.js";

const EXPECTED_HOOKS = {
  "codebuddy-cn": ["codebuddyHeaders"],
  "codebuddy-intl": ["codebuddyHeaders"],
  kimi: ["kimiHeaders"],
  "minimax-code": ["minimaxHeaders"],
  "minimax-code-global": ["minimaxHeaders"],
  muse: ["museHeaders"],
  cline: ["clineHeaders"],
  clinepass: ["clineHeaders"],
  kilocode: ["kilocodeOrg"],
};

describe("registry declares headerHooks (plan #1)", () => {
  it("each hooked provider declares transport.headerHooks", () => {
    for (const [provider, hooks] of Object.entries(EXPECTED_HOOKS)) {
      expect(PROVIDERS[provider]?.headerHooks).toEqual(hooks);
    }
  });
  it("no provider still declares auth.hooks (legacy location retired)", () => {
    for (const [id, t] of Object.entries(PROVIDERS)) {
      expect(t?.auth?.hooks, `${id} still has auth.hooks`).toBeUndefined();
      for (const tr of t?.transports || []) {
        expect(tr?.auth?.hooks, `${id} transport still has auth.hooks`).toBeUndefined();
      }
    }
  });
  it("opencode family opts into canonicalTools; others do not", () => {
    expect(PROVIDERS["opencode"]?.canonicalTools).toBe(true);
    expect(PROVIDERS["opencode-go"]?.canonicalTools).toBe(true);
    expect(PROVIDERS["opencode-zen"]?.canonicalTools).toBe(true);
    expect(PROVIDERS["codebuddy-cn"]?.canonicalTools).toBeUndefined();
    expect(PROVIDERS["kimi"]?.canonicalTools).toBeUndefined();
  });
});

describe("applyHeaderHooks", () => {
  it("runs the named hooks and ignores unknown names (fail-open)", () => {
    const headers = {};
    applyHeaderHooks(headers, ["codebuddyHeaders", "no-such-hook"], { apiKey: "k" });
    expect(headers["X-Request-ID"]).toBeTruthy();
    expect(headers["X-Conversation-Request-ID"]).toBe(headers["X-Request-ID"]);
    expect(headers["X-Conversation-Message-ID"]).toBe(headers["X-Request-ID"]);
    expect(headers["X-Conversation-ID"]).toBeTruthy();
    expect(headers["X-Conversation-ID"]).not.toBe(headers["X-Request-ID"]);
  });
  it("exposes all six hook implementations", () => {
    expect(Object.keys(HEADER_HOOKS).sort()).toEqual(
      ["clineHeaders", "codebuddyHeaders", "kilocodeOrg", "kimiHeaders", "minimaxHeaders", "museHeaders"]
    );
  });
});

describe("DefaultExecutor.buildHeaders (behavior unchanged)", () => {
  const creds = {
    apiKey: "test-key",
    accessToken: "test-token",
    providerSpecificData: { deviceId: "dev-1", orgId: "org-1" },
  };

  it("codebuddy: injects the four channel-verification ids", () => {
    const ex = new DefaultExecutor("codebuddy-cn");
    const h = ex.buildHeaders(creds, true, "https://example.com", "glm-5.2", {});
    expect(h["X-Request-ID"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(h["X-Conversation-Request-ID"]).toBe(h["X-Request-ID"]);
    expect(h["X-Conversation-Message-ID"]).toBe(h["X-Request-ID"]);
    expect(h["X-Conversation-ID"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("kimi: injects device headers from the connection deviceId", () => {
    const ex = new DefaultExecutor("kimi");
    const h = ex.buildHeaders(creds, true, "https://example.com", "kimi-k3", {});
    expect(h["X-Msh-Device-Id"]).toBe("dev-1");
    expect(h["X-Msh-Platform"]).toBe("9router");
  });

  it("minimax: placeholder x-api-key + session id (kept across calls)", () => {
    const ex = new DefaultExecutor("minimax-code");
    const h = ex.buildHeaders(creds, true, "https://example.com", "minimax-m3", {});
    expect(h["x-api-key"]).toBe("sk-xxx");
    expect(h["X-Mavis-Session-Id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(h["X-Mavis-Timezone-Offset"]).toBe(String(new Date().getTimezoneOffset() * -60));
  });

  it("muse: x-api-version only on subscription (accessToken, no apiKey)", () => {
    const ex = new DefaultExecutor("muse");
    const sub = ex.buildHeaders({ accessToken: "tok" }, true, "https://example.com", "muse-spark-1.3", {});
    expect(sub["x-api-version"]).toBe("1.0.0");
    const key = ex.buildHeaders({ apiKey: "key" }, true, "https://example.com", "muse-spark-1.3", {});
    expect(key["x-api-version"]).toBeUndefined();
  });

  it("kilocode: org header only when orgId is set", () => {
    const ex = new DefaultExecutor("kilocode");
    const withOrg = ex.buildHeaders(creds, true, "https://example.com", "m", {});
    expect(withOrg["X-Kilocode-OrganizationID"]).toBe("org-1");
    const withoutOrg = ex.buildHeaders({ apiKey: "k", providerSpecificData: {} }, true, "https://example.com", "m", {});
    expect(withoutOrg["X-Kilocode-OrganizationID"]).toBeUndefined();
  });
});
