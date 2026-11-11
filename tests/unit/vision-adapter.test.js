import { describe, it, expect, vi, beforeEach } from "vitest";

// DB-backed modules behind the gate are mocked so these tests run without
// a database. The pure helpers (visionAdapter) are NOT mocked — they run
// against the real capability tables.
vi.mock("@/lib/localDb", () => ({
  getCustomModels: vi.fn(async () => []),
}));
vi.mock("@/lib/db/repos/modelBrandsRepo.js", () => ({
  resolveBrandModel: vi.fn(async () => null),
}));
vi.mock("@/sse/services/model.js", () => ({
  getComboModels: vi.fn(async () => null),
}));
vi.mock("@/sse/services/keyAccess.js", () => ({
  filterModelsListForKey: vi.fn(async (_keyAccess, models) => models),
}));

import {
  hasImageContent,
  lookupVisionOverride,
  resolveVisionCapability,
  applyVisionOverrideToCaps,
  listVisionAlternatives,
} from "@/shared/utils/visionAdapter.js";

import {
  decideVisionGate,
  enforceVisionGate,
  resolveModelVision,
} from "@/sse/services/visionGate.js";

import { resolveBrandModel } from "@/lib/db/repos/modelBrandsRepo.js";

beforeEach(() => {
  vi.mocked(resolveBrandModel).mockResolvedValue(null);
});

// ---------------------------------------------------------------- hasImageContent
describe("hasImageContent", () => {
  it("text-only request has no image content", () => {
    expect(hasImageContent({ messages: [{ role: "user", content: "hello, what is 2+2?" }] })).toBe(false);
    expect(hasImageContent({})).toBe(false);
    expect(hasImageContent(null)).toBe(false);
    expect(hasImageContent({ messages: [] })).toBe(false);
  });
  it("detects OpenAI image_url parts (http url)", () => {
    expect(
      hasImageContent({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "what is in this image?" },
              { type: "image_url", image_url: { url: "https://example.com/cat.png" } },
            ],
          },
        ],
      })
    ).toBe(true);
  });
  it("detects base64 data URLs", () => {
    expect(
      hasImageContent({
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
            ],
          },
        ],
      })
    ).toBe(true);
  });
  it("detects Claude image blocks and Gemini inlineData", () => {
    expect(
      hasImageContent({
        messages: [
          { role: "user", content: [{ type: "image", source: { type: "base64", data: "abc" } }] },
        ],
      })
    ).toBe(true);
    expect(
      hasImageContent({
        messages: [
          { role: "user", content: [{ inlineData: { mimeType: "image/jpeg", data: "abc" } }] },
        ],
      })
    ).toBe(true);
    // Non-image inlineData does not count
    expect(
      hasImageContent({
        messages: [
          { role: "user", content: [{ inlineData: { mimeType: "application/pdf", data: "abc" } }] },
        ],
      })
    ).toBe(false);
  });
  it("detects Ollama images array and Responses-API input", () => {
    expect(hasImageContent({ messages: [{ role: "user", content: "x", images: ["aGVsbG8="] }] })).toBe(true);
    expect(
      hasImageContent({
        input: [
          { role: "user", content: [{ type: "input_image", image_url: "data:image/png;base64,abc" }] },
        ],
      })
    ).toBe(true);
  });
});

// ------------------------------------------------------- lookupVisionOverride
describe("lookupVisionOverride", () => {
  it("returns undefined without overrides", () => {
    expect(lookupVisionOverride({}, { provider: "kimi", model: "kimi-k3" })).toBeUndefined();
    expect(lookupVisionOverride(null, { provider: "kimi", model: "kimi-k3" })).toBeUndefined();
  });
  it("brand id wins over provider/model", () => {
    const overrides = { "h-router/ultra": false, "kimi/kimi-k3": true };
    expect(lookupVisionOverride(overrides, { provider: "kimi", model: "kimi-k3", brandModelId: "h-router/ultra" })).toBe(false);
  });
  it("matches provider/model keys", () => {
    expect(lookupVisionOverride({ "kimi/kimi-latest": false }, { provider: "kimi", model: "kimi-latest" })).toBe(false);
    expect(lookupVisionOverride({ "kimi/kimi-k3": true }, { provider: "kimi", model: "kimi-k3" })).toBe(true);
  });
});

// ------------------------------------------------------ resolveVisionCapability
describe("resolveVisionCapability", () => {
  it("admin override beats the capability table", () => {
    const out = resolveVisionCapability({
      provider: "kimi",
      model: "kimi-latest",
      overrides: { "kimi/kimi-latest": true },
    });
    expect(out.vision).toBe(true);
    expect(out.source).toBe("override");
  });
  it("imageToText-kind models are vision-capable", () => {
    const out = resolveVisionCapability({ provider: "oc", model: "gpt-5-chat", customKind: "imageToText" });
    expect(out.vision).toBe(true);
    expect(out.source).toBe("service-kind");
  });
  it("falls back to the capability table (known values, live)", () => {
    // Verified against the real getCapabilitiesForModel in this repo.
    expect(resolveVisionCapability({ provider: "kimi", model: "kimi-k3" }).vision).toBe(true);
    expect(resolveVisionCapability({ provider: "kimi", model: "kimi-latest" }).vision).toBe(false);
    expect(resolveVisionCapability({ provider: "deepseek", model: "deepseek-chat" }).vision).toBe(false);
    expect(resolveVisionCapability({ provider: "openai", model: "gpt-4o-mini" }).vision).toBe(true);
  });
  it("unknown models resolve vision=false (gate fails open on known=false)", () => {
    const out = resolveVisionCapability({ provider: "totally-fake", model: "no-such-model" });
    expect(out.vision).toBe(false);
    expect(out.source).toBe("capabilities");
  });
});

describe("applyVisionOverrideToCaps", () => {
  it("returns the input unchanged when nothing applies", () => {
    const caps = { vision: false };
    expect(applyVisionOverrideToCaps(caps, "kimi/kimi-latest", {})).toBe(caps);
    expect(applyVisionOverrideToCaps(caps, "kimi/kimi-latest", null)).toBe(caps);
  });
  it("replaces vision when an override applies", () => {
    const caps = { vision: false, contextWindow: 200000 };
    const out = applyVisionOverrideToCaps(caps, "kimi/kimi-latest", { "kimi/kimi-latest": true });
    expect(out.vision).toBe(true);
    expect(out.contextWindow).toBe(200000);
    expect(caps.vision).toBe(false); // input not mutated
  });
});

describe("listVisionAlternatives", () => {
  const catalog = [
    { provider: "kimi", model: "kimi-latest" },
    { provider: "kimi", model: "kimi-k3" },
    { provider: "openai", model: "gpt-4o-mini" },
    { provider: "deepseek", model: "deepseek-chat" },
  ];
  it("returns vision-capable models, same provider first, never the rejected one", async () => {
    const out = await listVisionAlternatives({ provider: "kimi", model: "kimi-latest", catalog });
    expect(out).toContain("kimi/kimi-k3");
    expect(out).toContain("openai/gpt-4o-mini");
    expect(out).not.toContain("kimi/kimi-latest");
    expect(out).not.toContain("deepseek/deepseek-chat");
    expect(out[0]).toBe("kimi/kimi-k3"); // same provider first
    expect(out.length).toBeLessThanOrEqual(5);
  });
  it("empty catalog yields empty alternatives", async () => {
    expect(await listVisionAlternatives({ provider: "kimi", model: "x", catalog: [] })).toEqual([]);
  });
  it("respects the isAllowed predicate (key-access filtering)", async () => {
    const out = await listVisionAlternatives({
      provider: "kimi",
      model: "kimi-latest",
      catalog,
      isAllowed: async (entry) => entry.provider === "openai",
    });
    expect(out).toEqual(["openai/gpt-4o-mini"]);
  });
});

// ------------------------------------------------------------ resolveModelVision
describe("resolveModelVision", () => {
  it("resolves provider/model strings to real capabilities", async () => {
    const k3 = await resolveModelVision({ modelStr: "kimi/kimi-k3" });
    expect(k3).toMatchObject({ provider: "kimi", model: "kimi-k3", vision: true, known: true });
    const latest = await resolveModelVision({ modelStr: "kimi/kimi-latest" });
    expect(latest).toMatchObject({ provider: "kimi", model: "kimi-latest", vision: false, known: true });
  });
  it("unresolvable strings are unknown (fail-open)", async () => {
    const out = await resolveModelVision({ modelStr: "some-combo-name" });
    expect(out.known).toBe(false);
  });
  it("brand id resolves to its upstream first", async () => {
    vi.mocked(resolveBrandModel).mockResolvedValueOnce({
      provider: "kimi",
      model: "kimi-k3",
      brand: { brandModelId: "h-router/ultra" },
    });
    const out = await resolveModelVision({ modelStr: "h-router/ultra", brandModelId: "h-router/ultra" });
    expect(out).toMatchObject({ provider: "kimi", model: "kimi-k3", vision: true, known: true });
  });
});

// ------------------------------------------------------------ decideVisionGate
describe("decideVisionGate (pure)", () => {
  it("passes text-only requests with zero gate effect", () => {
    const d = decideVisionGate({
      hasImage: false,
      candidates: [{ id: "kimi/kimi-latest", vision: false, known: true }],
    });
    expect(d.allowed).toBe(true);
  });
  it("passes image requests to vision models", () => {
    const d = decideVisionGate({
      hasImage: true,
      candidates: [{ id: "kimi/kimi-k3", vision: true, known: true }],
    });
    expect(d).toEqual({ allowed: true, reason: "vision-capable" });
  });
  it("denies image requests to known non-vision models", () => {
    const d = decideVisionGate({
      hasImage: true,
      candidates: [{ id: "kimi/kimi-latest", vision: false, known: true }],
    });
    expect(d).toEqual({ allowed: false, reason: "no-vision-model" });
  });
  it("fails open for unknown models (capability metadata missing)", () => {
    const d = decideVisionGate({
      hasImage: true,
      candidates: [{ id: "weird/new-model", vision: false, known: false }],
    });
    expect(d).toEqual({ allowed: true, reason: "unknown-candidate" });
  });
  it("passes a combo when any member can read images", () => {
    const d = decideVisionGate({
      hasImage: true,
      candidates: [
        { id: "kimi/kimi-latest", vision: false, known: true },
        { id: "kimi/kimi-k3", vision: true, known: true },
      ],
    });
    expect(d).toEqual({ allowed: true, reason: "vision-capable" });
  });
  it("passes when the capacity-adapter vision pool can redirect", () => {
    const d = decideVisionGate({
      hasImage: true,
      candidates: [{ id: "kimi/kimi-latest", vision: false, known: true }],
      adapterVisionPool: ["kimi/kimi-k3"],
    });
    expect(d).toEqual({ allowed: true, reason: "adapter-redirect" });
  });
});

// ----------------------------------------------------------- enforceVisionGate
describe("enforceVisionGate (async, mocked DB)", () => {
  const imageCaps = () => new Set(["vision"]);
  const textCaps = () => new Set();

  it("returns null for text-only requests (zero behavior change)", async () => {
    const res = await enforceVisionGate({
      modelStr: "kimi/kimi-latest",
      requiredCapabilities: textCaps(),
      settings: {},
    });
    expect(res).toBeNull();
  });

  it("returns a 400 naming the model + alternatives for image + non-vision", async () => {
    const res = await enforceVisionGate({
      modelStr: "kimi/kimi-latest",
      requiredCapabilities: imageCaps(),
      settings: {},
    });
    expect(res).not.toBeNull();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain("kimi/kimi-latest");
    expect(body.error.message).toMatch(/cannot read images/i);
    expect(body.error.message).toContain("kimi/kimi-k3"); // a vision alternative
  });

  it("returns null for image + vision model", async () => {
    const res = await enforceVisionGate({
      modelStr: "kimi/kimi-k3",
      requiredCapabilities: imageCaps(),
      settings: {},
    });
    expect(res).toBeNull();
  });

  it("admin override can flip a non-vision model to vision", async () => {
    const res = await enforceVisionGate({
      modelStr: "kimi/kimi-latest",
      requiredCapabilities: imageCaps(),
      settings: { visionOverrides: { "kimi/kimi-latest": true } },
    });
    expect(res).toBeNull();
  });

  it("admin override can flip a vision model to non-vision (then 400)", async () => {
    const res = await enforceVisionGate({
      modelStr: "kimi/kimi-k3",
      requiredCapabilities: imageCaps(),
      settings: { visionOverrides: { "kimi/kimi-k3": false } },
    });
    expect(res).not.toBeNull();
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain("kimi/kimi-k3");
  });

  it("brand resolving to a vision upstream passes; the 400 names the brand id", async () => {
    vi.mocked(resolveBrandModel).mockResolvedValueOnce({
      provider: "kimi",
      model: "kimi-k3",
      brand: { brandModelId: "h-router/ultra" },
    });
    const pass = await enforceVisionGate({
      modelStr: "h-router/ultra",
      brandModelId: "h-router/ultra",
      requiredCapabilities: imageCaps(),
      settings: {},
    });
    expect(pass).toBeNull();

    vi.mocked(resolveBrandModel).mockResolvedValueOnce({
      provider: "kimi",
      model: "kimi-latest",
      brand: { brandModelId: "h-router/basic" },
    });
    const denied = await enforceVisionGate({
      modelStr: "h-router/basic",
      brandModelId: "h-router/basic",
      requiredCapabilities: imageCaps(),
      settings: {},
    });
    expect(denied).not.toBeNull();
    expect(denied.status).toBe(400);
    expect((await denied.json()).error.message).toContain("h-router/basic");
  });

  it("capacity-adapter vision pool redirects instead of rejecting", async () => {
    const res = await enforceVisionGate({
      modelStr: "kimi/kimi-latest",
      requiredCapabilities: imageCaps(),
      settings: { capacityAdapter: { vision: { enabled: true, models: ["kimi/kimi-k3"] } } },
    });
    expect(res).toBeNull();
  });

  it("the factory-default pool (enabled, no models listed) does NOT redirect — 400", async () => {
    // Default settings ship vision: { enabled: true, models: [] }; the
    // adapter fills that with its default fallback, but an empty pool is
    // not an explicit admin redirect — the gate must still reject.
    const res = await enforceVisionGate({
      modelStr: "kimi/kimi-latest",
      requiredCapabilities: imageCaps(),
      settings: { capacityAdapter: { vision: { enabled: true, models: [] } } },
    });
    expect(res).not.toBeNull();
    expect(res.status).toBe(400);
  });

  it("unknown model fails open (no 400) — only when unresolvable to provider/model", async () => {
    // A slash-less name (e.g. a combo name) cannot be judged: fail open.
    const res = await enforceVisionGate({
      modelStr: "some-combo-name",
      requiredCapabilities: imageCaps(),
      settings: {},
    });
    expect(res).toBeNull();
  });

  it("a well-formed but unknown provider/model is treated as non-vision (conservative deny)", async () => {
    // Design note: only fully unresolvable candidates fail open. A
    // provider/model string absent from every capability table is denied;
    // the admin override is the escape hatch for new vision models.
    const res = await enforceVisionGate({
      modelStr: "weird/new-model",
      requiredCapabilities: imageCaps(),
      settings: {},
    });
    expect(res).not.toBeNull();
    expect(res.status).toBe(400);
  });
});
