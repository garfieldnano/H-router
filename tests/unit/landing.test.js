import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  fetchWithTimeout,
  normalizeModelsResponse,
  resolveCatalogModels,
  resolvePublishedModels,
  applyLandingModelNames,
  resolveCatalogBrands,
  resolveModelBrand,
  resolvePublicBaseUrl,
  formatLatency,
  formatLatencyShort,
  formatTokenCount,
  normalizeRecentRequests,
  formatRelativeTime,
  buildCodeSamples,
} from "@/shared/utils/landing.js";
import { LANDING_CONFIG, FALLBACK_MODELS, LANDING_BRANDS } from "@/shared/constants/landing.js";

// Public dir for the vendored brand logos (public/brands/*.svg).
const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../public");

// ---------------------------------------------------------------- config
describe("LANDING_CONFIG", () => {
  it("defaults the public base URL to the h-router gateway", () => {
    expect(LANDING_CONFIG.baseUrl).toBe("https://h-router.web.id/v1");
    expect(LANDING_CONFIG.baseUrl).not.toMatch(/\/$/);
  });

  it("points docs at the fork's docs/h-router index and the CTA at the bot", () => {
    expect(LANDING_CONFIG.docsUrl).toContain("garfieldnano/H-router");
    expect(LANDING_CONFIG.docsUrl).toContain("docs/h-router");
    expect(LANDING_CONFIG.telegramUrl).toBe("https://t.me/routermm_bot");
  });

  it("ships a curated fallback catalog from this gateway's own live list", () => {
    expect(Array.isArray(FALLBACK_MODELS)).toBe(true);
    expect(FALLBACK_MODELS.length).toBeGreaterThan(0);
    // Every entry is a real model id from our gateway (id + display name +
    // owning brand); ids are unique; no tier is invented — the gateway does
    // not publish tiers.
    const ids = new Set();
    for (const m of FALLBACK_MODELS) {
      expect(typeof m.id).toBe("string");
      expect(m.id).toContain("/");
      expect(ids.has(m.id)).toBe(false);
      ids.add(m.id);
      expect(typeof m.name).toBe("string");
      expect(m.name.length).toBeGreaterThan(0);
      expect(typeof m.ownedBy).toBe("string");
      expect(m.tier).toBeUndefined();
    }
  });

  it("ships a static brand list for the logo strip (12 brands)", () => {
    expect(LANDING_BRANDS).toHaveLength(12);
    const names = new Set();
    for (const b of LANDING_BRANDS) {
      expect(typeof b.name).toBe("string");
      expect(b.name.length).toBeGreaterThan(0);
      expect(names.has(b.name)).toBe(false);
      names.add(b.name);
      expect(b.logo === null || (typeof b.logo === "string" && (b.logo.startsWith("/brands/") || b.logo.startsWith("/providers/")) && /\.(svg|png)$/.test(b.logo))).toBe(true);
    }
    // Every brand now has a real vendored logo (Kimi: Moonshot AI mark,
    // GLM: Z.ai mark — both LobeHub mono SVG; xAI: official Grok logomark).
    // No brand falls back to a text badge anymore.
    expect(LANDING_BRANDS.filter((b) => b.logo === null).map((b) => b.name).sort()).toEqual([]);
  });

  it("vendors every brand logo as a valid image on disk", () => {
    for (const b of LANDING_BRANDS) {
      if (b.logo === null) continue;
      const file = resolve(PUBLIC_DIR, b.logo.replace(/^\//, ""));
      expect(existsSync(file)).toBe(true);
      if (file.endsWith(".png")) {
        const buf = readFileSync(file);
        expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
        continue;
      }
      const svg = readFileSync(file, "utf8");
      expect(svg).toMatch(/<svg[\s>]/);
      expect(svg).toContain("</svg>");
      expect(svg).toContain("<title>");
    }
  });
});

// ---------------------------------------------------------------- fetchWithTimeout
describe("fetchWithTimeout", () => {
  it("resolves when the fetch is fast and passes a signal through", async () => {
    let seen;
    const fast = async (url, { signal } = {}) => {
      seen = signal;
      return { ok: true };
    };
    const res = await fetchWithTimeout("/x", { timeoutMs: 1000, fetchFn: fast });
    expect(res.ok).toBe(true);
    expect(seen).toBeInstanceOf(AbortSignal);
  });

  it("aborts a hung fetch after the timeout instead of hanging forever", async () => {
    const never = (url, { signal } = {}) =>
      new Promise((_, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    const t0 = Date.now();
    await expect(fetchWithTimeout("/x", { timeoutMs: 20, fetchFn: never })).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

// ---------------------------------------------------------------- normalizeModelsResponse
describe("normalizeModelsResponse", () => {
  it("extracts id/name/ownedBy from an OpenAI-style list", () => {
    const out = normalizeModelsResponse({
      object: "list",
      data: [
        { id: "h-router/contoh", name: "Contoh", owned_by: "h-router" },
        { id: "oc/model-a", owned_by: "oc" },
      ],
    });
    expect(out).toEqual([
      { id: "h-router/contoh", name: "Contoh", ownedBy: "h-router" },
      { id: "oc/model-a", name: "oc/model-a", ownedBy: "oc" },
    ]);
  });

  it("drops entries without a usable id and tolerates malformed bodies", () => {
    expect(normalizeModelsResponse({ object: "list", data: [{ id: "" }, null, { name: "x" }, 42] })).toEqual([]);
    expect(normalizeModelsResponse(null)).toEqual([]);
    expect(normalizeModelsResponse({})).toEqual([]);
    expect(normalizeModelsResponse({ data: "bukan-array" })).toEqual([]);
  });
});

// ---------------------------------------------------------------- resolveCatalogModels
describe("resolveCatalogModels", () => {
  const live = Array.from({ length: 20 }, (_, i) => ({ id: `m/${i}`, name: `m/${i}`, ownedBy: "" }));
  const fallback = [{ id: "h-router/cadangan", name: "Cadangan", tier: "FREE" }];

  it("prefers the admin panel list over live and fallback data", () => {
    const admin = Array.from({ length: 15 }, (_, i) => ({ id: `admin/${i}`, name: `admin/${i}`, ownedBy: "" }));
    const r = resolveCatalogModels({ adminModels: admin, liveModels: live, fallbackModels: fallback, limit: 12 });
    expect(r.source).toBe("admin");
    expect(r.models).toHaveLength(12);
    expect(r.total).toBe(15);
    expect(r.models[0].id).toBe("admin/0");
  });

  it("honors an empty admin list instead of falling through to live or fallback", () => {
    const r = resolveCatalogModels({ adminModels: [], liveModels: live, fallbackModels: fallback });
    expect(r).toEqual({ models: [], total: 0, source: "admin" });
  });

  it("falls through to live data when the admin endpoint was not reached", () => {
    const r = resolveCatalogModels({ adminModels: undefined, liveModels: live, fallbackModels: fallback, limit: 12 });
    expect(r.source).toBe("live");
    expect(r.total).toBe(20);
  });

  it("prefers live data and caps the first page", () => {
    const r = resolveCatalogModels({ liveModels: live, fallbackModels: fallback, limit: 12 });
    expect(r.source).toBe("live");
    expect(r.models).toHaveLength(12);
    expect(r.total).toBe(20);
  });

  it("uses the fallback list only when the live list is empty", () => {
    const r = resolveCatalogModels({ liveModels: [], fallbackModels: fallback });
    expect(r.source).toBe("fallback");
    expect(r.models).toEqual(fallback);
    expect(r.total).toBe(1);
  });

  it("reports empty when neither source has models", () => {
    expect(resolveCatalogModels({ liveModels: [], fallbackModels: [] })).toEqual({ models: [], total: 0, source: "empty" });
    expect(resolveCatalogModels({})).toEqual({ models: [], total: 0, source: "empty" });
  });
});

// ---------------------------------------------------------------- resolvePublishedModels
describe("resolvePublishedModels", () => {
  const models = [
    { id: "a/one", name: "One", ownedBy: "A" },
    { id: "b/two", name: "Two", ownedBy: "B" },
    { id: "c/three", name: "Three", ownedBy: "C" },
  ];

  it("returns everything when the admin picked nothing", () => {
    expect(resolvePublishedModels({ models, picked: [] })).toEqual(models);
    expect(resolvePublishedModels({ models })).toEqual(models);
    expect(resolvePublishedModels({ models, picked: null })).toEqual(models);
  });

  it("keeps only the picked ids, in the picked order", () => {
    const r = resolvePublishedModels({ models, picked: ["c/three", "a/one"] });
    expect(r.map((m) => m.id)).toEqual(["c/three", "a/one"]);
  });

  it("drops picked ids that no longer exist and collapses duplicates", () => {
    const r = resolvePublishedModels({ models, picked: ["b/two", "gone/model", "b/two", "a/one"] });
    expect(r.map((m) => m.id)).toEqual(["b/two", "a/one"]);
  });

  it("tolerates missing inputs", () => {
    expect(resolvePublishedModels({})).toEqual([]);
    expect(resolvePublishedModels({ models: null, picked: ["a/one"] })).toEqual([]);
  });
});

// ---------------------------------------------------------------- applyLandingModelNames (Landing catalog Rename)
describe("applyLandingModelNames", () => {
  const models = [
    { id: "coarena/deepseek-v4-1-flash-1017", name: "deepseek-v4-1-flash-1017", ownedBy: "coarena" },
    { id: "coarena/gemini-3-8-flash", name: "gemini-3-8-flash", ownedBy: "coarena" },
  ];

  it("replaces the name with the admin's custom display name", () => {
    const r = applyLandingModelNames(models, {
      "coarena/deepseek-v4-1-flash-1017": "DeepSeek V4.1 Flash",
    });
    expect(r[0].name).toBe("DeepSeek V4.1 Flash");
    expect(r[0].id).toBe("coarena/deepseek-v4-1-flash-1017");
    expect(r[1].name).toBe("gemini-3-8-flash");
  });

  it("ignores empty or whitespace-only names and tolerates missing inputs", () => {
    const r = applyLandingModelNames(models, {
      "coarena/deepseek-v4-1-flash-1017": "   ",
      "coarena/gemini-3-8-flash": "",
    });
    expect(r.map((m) => m.name)).toEqual(["deepseek-v4-1-flash-1017", "gemini-3-8-flash"]);
    expect(applyLandingModelNames(models, null)).toEqual(models);
    expect(applyLandingModelNames(models)).toEqual(models);
    expect(applyLandingModelNames(null, { "coarena/deepseek-v4-1-flash-1017": "X" })).toEqual([]);
  });
});

// ---------------------------------------------------------------- formatLatency
describe("formatLatency", () => {
  it("formats sub-second values as ms and seconds with two decimals", () => {
    expect(formatLatency(42)).toBe("42 ms");
    expect(formatLatency(920)).toBe("920 ms");
    expect(formatLatency(1234)).toBe("1.23 dtk");
  });

  it("never invents a number for bad input", () => {
    expect(formatLatency(NaN)).toBe("—");
    expect(formatLatency(-1)).toBe("—");
    expect(formatLatency(undefined)).toBe("—");
  });
});

// ---------------------------------------------------------------- resolveCatalogBrands
describe("resolveCatalogBrands", () => {
  const brands = LANDING_BRANDS;

  it("maps provider aliases to their brands (alicode -> Qwen, deepseek-web -> DeepSeek, groq -> Meta)", () => {
    const r = resolveCatalogBrands({
      models: [
        { id: "alicode-intl/qwen3.5-plus", name: "Qwen 3.5 Plus", ownedBy: "Alibaba" },
        { id: "deepseek-web/deepseek-v4-flash", name: "DeepSeek V4 Flash", ownedBy: "DeepSeek" },
        { id: "groq/meta-llama/llama-4-maverick-17b-128e-instruct", name: "Llama 4 Maverick", ownedBy: "Meta" },
      ],
      brands,
    });
    expect(r.map((b) => b.name)).toEqual(["Qwen", "DeepSeek", "Meta"]);
    expect(r[0].logo).toBe("/providers/qwen.png");
  });

  it("dedups brands and preserves first-seen order", () => {
    const r = resolveCatalogBrands({
      models: [
        { id: "openai/gpt-5.5", name: "GPT-5.5", ownedBy: "OpenAI" },
        { id: "openai/gpt-5.4", name: "GPT-5.4", ownedBy: "OpenAI" },
        { id: "anthropic/claude-opus-4", name: "Claude Opus 4", ownedBy: "Anthropic" },
      ],
      brands,
    });
    expect(r.map((b) => b.name)).toEqual(["OpenAI", "Claude"]);
  });

  it("resolves through the owner name when the provider alias is unknown", () => {
    const r = resolveCatalogBrands({
      models: [{ id: "oc/model-a", name: "Model A", ownedBy: "Moonshot" }],
      brands,
    });
    expect(r.map((b) => b.name)).toEqual(["Kimi"]);
  });

  it("caps at the limit and keeps unknown owners as text badges", () => {
    const r = resolveCatalogBrands({
      models: [
        { id: "oc/model-a", name: "A", ownedBy: "MerekLain" },
        { id: "openai/gpt-5.5", name: "GPT-5.5", ownedBy: "OpenAI" },
        { id: "anthropic/claude-opus-4", name: "Claude", ownedBy: "Anthropic" },
      ],
      brands,
      limit: 2,
    });
    expect(r.map((b) => b.name)).toEqual(["MerekLain", "OpenAI"]);
    expect(r[0].logo).toBeNull();
  });

  it("skips models with no usable id or brand and tolerates missing inputs", () => {
    expect(resolveCatalogBrands({ models: [{ id: "", ownedBy: "" }, null, { name: "x" }], brands })).toEqual([]);
    expect(resolveCatalogBrands({})).toEqual([]);
  });
});

// ---------------------------------------------------------------- resolveModelBrand
describe("resolveModelBrand", () => {
  const brands = LANDING_BRANDS;

  it("resolves a model to its brand with the vendored logo", () => {
    expect(resolveModelBrand({ id: "alicode-intl/qwen3.5-plus", ownedBy: "Alibaba Coding", brands })).toEqual({
      name: "Qwen",
      logo: "/providers/qwen.png",
    });
    expect(resolveModelBrand({ id: "groq/meta-llama/llama-4-maverick-17b-128e-instruct", ownedBy: "Meta", brands }).name).toBe("Meta");
  });

  it("resolves the real brand from the model family when the provider is an aggregator (coarena)", () => {
    // coarena is a proxy: the provider alias and owner both say "coarena",
    // so the brand must come from the model name — never a "coarena" badge.
    // Logos are the same /providers/*.png files the admin Providers menu
    // uses, so the landing and the admin show identical brand marks.
    // Claude models use the Claude mark (orange asterisk, /providers/claude.png)
    // — the same logo as the Claude Code provider card in the admin menu.
    expect(resolveModelBrand({ id: "coarena/claude-opus-5-5", ownedBy: "coarena", brands })).toEqual({
      name: "Claude",
      logo: "/providers/claude.png",
    });
    expect(resolveModelBrand({ id: "coarena/claude-sonnet-5-5", ownedBy: "coarena", brands }).name).toBe("Claude");
    expect(resolveModelBrand({ id: "coarena/claude-haiku-5-5", ownedBy: "coarena", brands }).name).toBe("Claude");
    expect(resolveModelBrand({ id: "coarena/deepseek-v4-1-flash-1017", ownedBy: "coarena", brands })).toEqual({
      name: "DeepSeek",
      logo: "/providers/deepseek.png",
    });
    expect(resolveModelBrand({ id: "coarena/gemini-3-8-flash", ownedBy: "coarena", brands })).toEqual({
      name: "Google Gemini",
      logo: "/providers/gemini.png",
    });
  });

  it("returns a text badge when the brand has no vendored logo", () => {
    expect(resolveModelBrand({ id: "oc/model-a", ownedBy: "MerekLain", brands })).toEqual({
      name: "MerekLain",
      logo: null,
    });
  });

  it("returns null when the brand cannot be resolved at all", () => {
    expect(resolveModelBrand({ id: "", ownedBy: "", brands })).toBeNull();
    expect(resolveModelBrand({})).toBeNull();
  });
});

// ---------------------------------------------------------------- resolvePublicBaseUrl
describe("resolvePublicBaseUrl", () => {
  it("prefers an operator-pinned base URL and trims trailing slashes", () => {
    expect(
      resolvePublicBaseUrl({ host: "20127-x.daytonaproxy01.net", proto: "https", pinnedBaseUrl: "https://h-router.web.id/v1/" })
    ).toBe("https://h-router.web.id/v1");
  });

  it("derives the address from the public host behind the proxy", () => {
    expect(
      resolvePublicBaseUrl({ host: "20127-x.daytonaproxy01.net", proto: "https", pinnedBaseUrl: "" })
    ).toBe("https://20127-x.daytonaproxy01.net/v1");
  });

  it("uses http for localhost and https otherwise when no proto is given", () => {
    expect(resolvePublicBaseUrl({ host: "localhost:20127", proto: "" })).toBe("http://localhost:20127/v1");
    expect(resolvePublicBaseUrl({ host: "h-router.web.id", proto: "" })).toBe("https://h-router.web.id/v1");
  });

  it("falls back to the built-in default when no host is known", () => {
    expect(resolvePublicBaseUrl({})).toBe(LANDING_CONFIG.baseUrl);
    expect(resolvePublicBaseUrl({ host: "   " })).toBe(LANDING_CONFIG.baseUrl);
  });
});

// ---------------------------------------------------------------- formatLatencyShort
describe("formatLatencyShort", () => {
  it("formats sub-second values as ms and seconds with two decimals", () => {
    expect(formatLatencyShort(42)).toBe("42ms");
    expect(formatLatencyShort(1067)).toBe("1.07s");
  });

  it("never invents a number for bad input", () => {
    expect(formatLatencyShort(NaN)).toBe("—");
    expect(formatLatencyShort(-1)).toBe("—");
    expect(formatLatencyShort(undefined)).toBe("—");
  });
});

// ---------------------------------------------------------------- formatTokenCount
describe("formatTokenCount", () => {
  it("renders small counts as-is and compacts thousands and millions", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(42)).toBe("42");
    expect(formatTokenCount(999)).toBe("999");
    expect(formatTokenCount(1200)).toBe("1.2 rb");
    expect(formatTokenCount(1234567)).toBe("1.23 jt");
    expect(formatTokenCount(1000000)).toBe("1 jt");
  });

  it("never invents a number for bad input", () => {
    expect(formatTokenCount(NaN)).toBe("—");
    expect(formatTokenCount(-1)).toBe("—");
    expect(formatTokenCount(undefined)).toBe("—");
  });
});

// ---------------------------------------------------------------- normalizeRecentRequests
describe("normalizeRecentRequests", () => {
  const row = {
    timestamp: "2026-11-12T15:30:00.000Z",
    model: "alicode-intl/qwen3.5-plus",
    endpoint: "/v1/chat/completions",
    status: "ok",
    tokens: 1234,
  };

  it("passes well-shaped rows through unchanged", () => {
    expect(normalizeRecentRequests({ requests: [row] })).toEqual([row]);
    expect(normalizeRecentRequests({ requests: [] })).toEqual([]);
  });

  it("returns null when the payload is not a requests array", () => {
    expect(normalizeRecentRequests(null)).toBeNull();
    expect(normalizeRecentRequests({})).toBeNull();
    expect(normalizeRecentRequests({ requests: "nope" })).toBeNull();
  });

  it("drops malformed rows and strips any extra fields", () => {
    expect(
      normalizeRecentRequests({
        requests: [
          row,
          { ...row, model: "" },
          { ...row, tokens: "1234" },
          { ...row, timestamp: 123 },
          { ...row, apiKey: "sk-secret", cost: 9.99 },
        ],
      })
    ).toEqual([row, row]);
  });
});

// ---------------------------------------------------------------- formatRelativeTime
describe("formatRelativeTime", () => {
  const now = Date.parse("2026-11-12T15:30:00.000Z");

  it("says 'baru saja' under a minute, minutes then hours", () => {
    expect(formatRelativeTime("2026-11-12T15:29:30.000Z", now)).toBe("baru saja");
    expect(formatRelativeTime("2026-11-12T15:28:00.000Z", now)).toBe("2 mnt lalu");
    expect(formatRelativeTime("2026-11-12T13:30:00.000Z", now)).toBe("2 jam lalu");
  });

  it("falls back to DD/MM past a day and a dash for bad input", () => {
    expect(formatRelativeTime("2026-11-10T15:30:00.000Z", now)).toBe("10/11");
    expect(formatRelativeTime("not-a-date", now)).toBe("—");
    expect(formatRelativeTime(null, now)).toBe("—");
  });
});

// ---------------------------------------------------------------- buildCodeSamples
describe("buildCodeSamples", () => {
  it("builds cURL/Python/Node samples from one base URL + key + model", () => {
    const s = buildCodeSamples({ baseUrl: "https://h-router.web.id/v1", apiKey: "h-router-abc", model: "h-router/contoh" });
    expect(s.curl).toContain("curl https://h-router.web.id/v1/chat/completions");
    expect(s.curl).toContain('Bearer h-router-abc');
    expect(s.curl).toContain('"model": "h-router/contoh"');
    expect(s.python).toContain('base_url="https://h-router.web.id/v1"');
    expect(s.python).toContain('model="h-router/contoh"');
    expect(s.node).toContain('baseURL: "https://h-router.web.id/v1"');
    expect(s.node).toContain('model: "h-router/contoh"');
  });

  it("uses a visible placeholder model id and never invents one", () => {
    const s = buildCodeSamples({ baseUrl: "https://h-router.web.id/v1/" });
    expect(s.curl).toContain('"<id-model>"');
    expect(s.curl).toContain("Bearer h-router-...");
    // Trailing slash on the base URL is normalized away.
    expect(s.curl).not.toContain("v1//chat");
  });
});
