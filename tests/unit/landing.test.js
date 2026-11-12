import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  fetchWithTimeout,
  normalizeModelsResponse,
  resolveCatalogModels,
  formatLatency,
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
      expect(b.logo === null || (typeof b.logo === "string" && b.logo.startsWith("/brands/") && /\.(svg|png)$/.test(b.logo))).toBe(true);
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
