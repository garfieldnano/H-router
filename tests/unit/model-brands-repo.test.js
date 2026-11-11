// Model brands + live prompts repo (plan #2, schema v8).
// Runs against an isolated temp DATA_DIR.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-brands-test-"));
let db;

beforeAll(async () => {
  process.env.DATA_DIR = tmpDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe("model_brands repo", () => {
  it("creates the v8 tables on init (empty to start)", async () => {
    expect(await db.getModelBrands()).toEqual([]);
    expect(await db.getLivePrompts()).toEqual([]);
  });

  it("creates a brand and resolves it to upstream", async () => {
    const brand = await db.createModelBrand({
      brandModelId: "h-router/ultra",
      upstreamProvider: "codebuddy",
      upstreamModel: "claude-sonnet-4",
      displayName: "Ultra",
    });
    expect(brand.id).toBeTruthy();
    expect(brand.displayName).toBe("Ultra");
    expect(brand.isActive).toBe(true);
    const resolved = await db.resolveBrandModel("h-router/ultra");
    expect(resolved).toMatchObject({ provider: "codebuddy", model: "claude-sonnet-4" });
    expect(resolved.brand.brandModelId).toBe("h-router/ultra");
  });

  it("displayName defaults to the brand id", async () => {
    const brand = await db.createModelBrand({
      brandModelId: "h-router/plain",
      upstreamProvider: "kimi",
      upstreamModel: "kimi-k2",
    });
    expect(brand.displayName).toBe("h-router/plain");
  });

  it("rejects a duplicate brand id and a malformed id", async () => {
    await expect(db.createModelBrand({
      brandModelId: "h-router/ultra",
      upstreamProvider: "kimi",
      upstreamModel: "kimi-k2",
    })).rejects.toThrow(/sudah ada/i);
    await expect(db.createModelBrand({
      brandModelId: "no-slash-here",
      upstreamProvider: "kimi",
      upstreamModel: "kimi-k2",
    })).rejects.toThrow(/prefix\/nama/);
    await expect(db.createModelBrand({
      brandModelId: "h-router/has space",
      upstreamProvider: "kimi",
      upstreamModel: "kimi-k2",
    })).rejects.toThrow(/prefix\/nama/);
  });

  it("inactive brands do not resolve", async () => {
    const brand = await db.createModelBrand({
      brandModelId: "h-router/off",
      upstreamProvider: "kimi",
      upstreamModel: "kimi-k2",
    });
    await db.updateModelBrand(brand.id, { isActive: false });
    expect(await db.resolveBrandModel("h-router/off")).toBeNull();
    // Unknown brand ids resolve to null too.
    expect(await db.resolveBrandModel("h-router/never-existed")).toBeNull();
  });

  it("update renames the upstream and reactivation resolves again", async () => {
    const brand = await db.getModelBrandByBrandId("h-router/off");
    const updated = await db.updateModelBrand(brand.id, {
      upstreamModel: "kimi-k2-thinking",
      isActive: true,
    });
    expect(updated.upstreamModel).toBe("kimi-k2-thinking");
    expect(await db.resolveBrandModel("h-router/off")).toMatchObject({ model: "kimi-k2-thinking" });
  });

  it("delete removes the brand", async () => {
    const brand = await db.getModelBrandByBrandId("h-router/plain");
    expect(await db.deleteModelBrand(brand.id)).toBe(true);
    expect(await db.getModelBrandById(brand.id)).toBeNull();
    expect(await db.deleteModelBrand(brand.id)).toBe(false);
  });
});

describe("live_prompts repo", () => {
  it("creates a brand-scoped prompt and a provider-wide prompt", async () => {
    const byBrand = await db.createLivePrompt({
      brandModelId: "h-router/ultra",
      systemPrompt: "Brand prompt.",
      mode: "prepend",
    });
    expect(byBrand.mode).toBe("prepend");
    const byProvider = await db.createLivePrompt({
      provider: "kimi",
      systemPrompt: "Kimi prompt.",
      mode: "append",
    });
    expect(byProvider.model).toBeNull();
  });

  it("rejects a duplicate prompt at the same specificity", async () => {
    await expect(db.createLivePrompt({
      brandModelId: "h-router/ultra",
      systemPrompt: "Second brand prompt.",
    })).rejects.toThrow(/sudah ada/i);
    await expect(db.createLivePrompt({
      provider: "kimi",
      systemPrompt: "Second kimi prompt.",
    })).rejects.toThrow(/sudah ada/i);
  });

  it("rejects prompts with no target and an invalid mode", async () => {
    await expect(db.createLivePrompt({ systemPrompt: "Nowhere." }))
      .rejects.toThrow(/menarget/);
    await expect(db.createLivePrompt({ provider: "kimi", model: "kimi-k2", systemPrompt: "x", mode: "sideways" }))
      .rejects.toThrow(/mode harus/);
    await expect(db.createLivePrompt({ provider: "kimi", systemPrompt: "   " }))
      .rejects.toThrow(/tidak boleh kosong/);
  });

  it("findLivePromptForRequest prefers brand > exact model > provider", async () => {
    await db.createLivePrompt({ provider: "codebuddy", model: "claude-sonnet-4", systemPrompt: "Exact model prompt.", mode: "replace" });
    await db.createLivePrompt({ provider: "codebuddy", systemPrompt: "Provider prompt.", mode: "prepend" });

    // Brand request: brand prompt wins over exact + provider.
    const byBrand = await db.findLivePromptForRequest({ brandModelId: "h-router/ultra", provider: "codebuddy", model: "claude-sonnet-4" });
    expect(byBrand.systemPrompt).toBe("Brand prompt.");
    // Same upstream, no brand: exact model wins over provider-wide.
    const exact = await db.findLivePromptForRequest({ provider: "codebuddy", model: "claude-sonnet-4" });
    expect(exact.systemPrompt).toBe("Exact model prompt.");
    // Other model on the same provider: provider-wide prompt.
    const wide = await db.findLivePromptForRequest({ provider: "codebuddy", model: "claude-opus-4" });
    expect(wide.systemPrompt).toBe("Provider prompt.");
    // Unrelated provider: nothing.
    expect(await db.findLivePromptForRequest({ provider: "qoder", model: "x" })).toBeNull();
  });

  it("inactive prompts are invisible to lookup", async () => {
    const p = await db.getLivePrompts().then((rows) => rows.find((r) => r.systemPrompt === "Provider prompt."));
    await db.updateLivePrompt(p.id, { isActive: false });
    expect(await db.findLivePromptForRequest({ provider: "codebuddy", model: "claude-opus-4" })).toBeNull();
    await db.updateLivePrompt(p.id, { isActive: true });
    expect(await db.findLivePromptForRequest({ provider: "codebuddy", model: "claude-opus-4" })).not.toBeNull();
  });

  it("update can retarget a prompt; delete removes it", async () => {
    const p = await db.getLivePrompts().then((rows) => rows.find((r) => r.systemPrompt === "Kimi prompt."));
    const updated = await db.updateLivePrompt(p.id, { mode: "replace", systemPrompt: "Kimi prompt v2." });
    expect(updated.mode).toBe("replace");
    expect(updated.systemPrompt).toBe("Kimi prompt v2.");
    expect(await db.deleteLivePrompt(p.id)).toBe(true);
    expect(await db.getLivePromptById(p.id)).toBeNull();
  });

  it("export/import round-trips brands and prompts", async () => {
    const exported = await db.exportDb();
    expect(exported.model_brands.map((b) => b.brandModelId).sort()).toContain("h-router/ultra");
    expect(exported.live_prompts.length).toBeGreaterThan(0);
    await db.importDb(exported);
    expect(await db.resolveBrandModel("h-router/ultra")).toMatchObject({ provider: "codebuddy" });
    const again = await db.findLivePromptForRequest({ brandModelId: "h-router/ultra", provider: "codebuddy", model: "claude-sonnet-4" });
    expect(again.systemPrompt).toBe("Brand prompt.");
  });
});
