import { describe, it, expect } from "vitest";

import {
  normalizeModelsResponse,
  resolveCatalogModels,
  formatLatency,
  buildCodeSamples,
} from "@/shared/utils/landing.js";
import { LANDING_CONFIG, FALLBACK_MODELS } from "@/shared/constants/landing.js";

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

  it("ships an empty, editable fallback catalog (live data is the source of truth)", () => {
    expect(Array.isArray(FALLBACK_MODELS)).toBe(true);
    expect(FALLBACK_MODELS).toHaveLength(0);
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
