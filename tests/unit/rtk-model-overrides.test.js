// RTK per-model toggle (plan G9): resolveRtkEnabled + normalizer/set/remove.
// The global settings.rtkEnabled is the default; a boolean entry for the
// exact "provider/model" in settings.rtkModelOverrides wins.
import { describe, it, expect } from "vitest";
import {
  rtkModelKey,
  resolveRtkEnabled,
  normalizeRtkModelOverrides,
  setRtkModelOverride,
  removeRtkModelOverride,
} from "../../src/shared/utils/rtkModel.js";

describe("rtkModelKey", () => {
  it("builds provider/model keys", () => {
    expect(rtkModelKey("kimi", "k2")).toBe("kimi/k2");
    expect(rtkModelKey(" codebuddy ", " claude-sonnet-4-5 ")).toBe(
      "codebuddy/claude-sonnet-4-5"
    );
  });

  it("rejects malformed keys", () => {
    expect(rtkModelKey("kimi", "")).toBeNull();
    expect(rtkModelKey("", "k2")).toBeNull();
    expect(rtkModelKey("kimi/k2", "x")).toBeNull();
    expect(rtkModelKey("kimi", "k 2")).toBeNull();
    expect(rtkModelKey(null, "k2")).toBeNull();
    expect(rtkModelKey("kimi", undefined)).toBeNull();
  });
});

describe("resolveRtkEnabled", () => {
  it("global on + no overrides = on", () => {
    expect(resolveRtkEnabled({ rtkEnabled: true }, "kimi", "k2")).toBe(true);
    expect(resolveRtkEnabled({}, "kimi", "k2")).toBe(true); // default is on
    expect(resolveRtkEnabled(undefined, "kimi", "k2")).toBe(true);
  });

  it("global off + no overrides = off", () => {
    expect(resolveRtkEnabled({ rtkEnabled: false }, "kimi", "k2")).toBe(false);
  });

  it("per-model override off wins over global on", () => {
    expect(
      resolveRtkEnabled(
        { rtkEnabled: true, rtkModelOverrides: { "kimi/k2": false } },
        "kimi",
        "k2"
      )
    ).toBe(false);
  });

  it("per-model override on wins over global off", () => {
    expect(
      resolveRtkEnabled(
        { rtkEnabled: false, rtkModelOverrides: { "kimi/k2": true } },
        "kimi",
        "k2"
      )
    ).toBe(true);
  });

  it("override for another model does not apply", () => {
    expect(
      resolveRtkEnabled(
        { rtkEnabled: true, rtkModelOverrides: { "kimi/k2": false } },
        "kimi",
        "k3"
      )
    ).toBe(true);
    expect(
      resolveRtkEnabled(
        { rtkEnabled: true, rtkModelOverrides: { "kimi/k2": false } },
        "codebuddy",
        "k2"
      )
    ).toBe(true);
  });

  it("non-boolean override values are ignored", () => {
    expect(
      resolveRtkEnabled(
        { rtkEnabled: true, rtkModelOverrides: { "kimi/k2": "yes" } },
        "kimi",
        "k2"
      )
    ).toBe(true);
    expect(
      resolveRtkEnabled(
        { rtkEnabled: false, rtkModelOverrides: { "kimi/k2": 0 } },
        "kimi",
        "k2"
      )
    ).toBe(false);
  });

  it("missing/invalid model falls back to global", () => {
    expect(
      resolveRtkEnabled(
        { rtkEnabled: false, rtkModelOverrides: { "kimi/k2": true } },
        "kimi",
        ""
      )
    ).toBe(false);
  });
});

describe("normalizeRtkModelOverrides", () => {
  it("keeps only valid boolean entries", () => {
    expect(
      normalizeRtkModelOverrides({
        "kimi/k2": false,
        "codebuddy/x": true,
        badkey: true,
        "kimi/k3": "off",
        "a/b/c": true,
      })
    ).toEqual({ "kimi/k2": false, "codebuddy/x": true });
  });

  it("returns {} for non-objects", () => {
    expect(normalizeRtkModelOverrides(null)).toEqual({});
    expect(normalizeRtkModelOverrides("kimi/k2")).toEqual({});
    expect(normalizeRtkModelOverrides(["kimi/k2"])).toEqual({});
  });

  it("does not mutate the input", () => {
    const input = { "kimi/k2": true, junk: 1 };
    const out = normalizeRtkModelOverrides(input);
    expect(out).toEqual({ "kimi/k2": true });
    expect(input).toEqual({ "kimi/k2": true, junk: 1 });
  });
});

describe("set/removeRtkModelOverride", () => {
  it("set adds or updates immutably", () => {
    const base = { "kimi/k2": true };
    const next = setRtkModelOverride(base, "kimi", "k3", false);
    expect(next).toEqual({ "kimi/k2": true, "kimi/k3": false });
    expect(base).toEqual({ "kimi/k2": true });
    expect(setRtkModelOverride(next, "kimi", "k2", false)).toEqual({
      "kimi/k2": false,
      "kimi/k3": false,
    });
  });

  it("set ignores invalid keys/values", () => {
    expect(setRtkModelOverride({}, "kimi", "", true)).toEqual({});
    expect(setRtkModelOverride({ "kimi/k2": true }, "kimi", "k2", "yes")).toEqual({
      "kimi/k2": true,
    });
  });

  it("remove drops the entry immutably", () => {
    const base = { "kimi/k2": true, "kimi/k3": false };
    expect(removeRtkModelOverride(base, "kimi", "k2")).toEqual({
      "kimi/k3": false,
    });
    expect(base).toEqual({ "kimi/k2": true, "kimi/k3": false });
    expect(removeRtkModelOverride(base, "kimi", "k9")).toEqual(base);
  });
});
