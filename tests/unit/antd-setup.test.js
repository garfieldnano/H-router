import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getAntdTheme, HROUTER_ANTD_TOKEN } from "@/shared/theme/antdTheme";
import { theme as antdTheme } from "antd";

const root = (...parts) =>
  resolve(dirname(fileURLToPath(import.meta.url)), ...parts);
const read = (p) => readFileSync(root(p), "utf8");

describe("antd theme tokens", () => {
  it("uses the h-router brand green as colorPrimary", () => {
    expect(HROUTER_ANTD_TOKEN.colorPrimary).toBe("#05f170");
  });

  it("uses the dark algorithm in dark mode and the default algorithm in light mode", () => {
    expect(getAntdTheme(true).algorithm).toBe(antdTheme.darkAlgorithm);
    expect(getAntdTheme(false).algorithm).toBe(antdTheme.defaultAlgorithm);
  });

  it("keeps the same token object for both modes", () => {
    expect(getAntdTheme(true).token).toBe(HROUTER_ANTD_TOKEN);
    expect(getAntdTheme(false).token).toBe(HROUTER_ANTD_TOKEN);
  });
});

describe("antd provider wiring", () => {
  it("mounts AntdProvider in the root layout", () => {
    expect(read("../../src/app/layout.js")).toContain("AntdProvider");
  });

  it("wires AntdRegistry with layer + ConfigProvider with the h-router theme", () => {
    const provider = read("../../src/shared/components/AntdProvider.js");
    expect(provider).toContain("AntdRegistry");
    expect(provider).toContain("ConfigProvider");
    expect(provider).toContain("layer");
    expect(provider).toContain("getAntdTheme");
  });

  it("declares the antd cascade layer before the Tailwind import", () => {
    const css = read("../../src/app/globals.css");
    const layerDecl = css.indexOf("@layer theme, base, antd, components, utilities;");
    expect(layerDecl).toBeGreaterThanOrEqual(0);
    expect(layerDecl).toBeLessThan(css.indexOf('@import "tailwindcss"'));
  });
});

describe("Usage page uses antd", () => {
  it("imports antd components in every Usage page piece", () => {
    const files = [
      "../../src/app/(dashboard)/dashboard/usage/page.js",
      "../../src/shared/components/UsageStats.js",
      "../../src/app/(dashboard)/dashboard/usage/components/UsageTable.js",
      "../../src/app/(dashboard)/dashboard/usage/components/OverviewCards.js",
      "../../src/shared/components/RequestLogger.js",
      "../../src/app/(dashboard)/dashboard/usage/components/RequestDetailsTab.js",
    ];
    for (const f of files) {
      expect(read(f)).toContain('from "antd"');
    }
  });

  it("keeps the member restrictions in the Usage page", () => {
    const page = read("../../src/app/(dashboard)/dashboard/usage/page.js");
    expect(page).toContain("isMember");
    // Details tab is admin-only; members only get Overview.
    expect(page).toContain('"details"');
  });

  it("keeps the member guard in the Details tab (admin-only route)", () => {
    const page = read("../../src/app/(dashboard)/dashboard/usage/page.js");
    expect(page).toContain("Per-request conversation details are not available");
  });
});
