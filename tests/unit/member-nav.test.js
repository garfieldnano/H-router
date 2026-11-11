import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Member menu (2026-11-11, revised same day): the member sidebar must list
// exactly the 5 member pages, in this order, with the admin labels/icons/
// hrefs. Providers, Combo & Vision Adapter, and Token Saver are admin-only
// (user correction). No admin-only page (health scanner, key usage, traffic,
// conversations, playground, anything from the System section) may appear
// in the member nav.
const SIDEBAR = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../src/shared/components/Sidebar.js"),
  "utf8"
);

function memberNavBlock() {
  const start = SIDEBAR.indexOf("const memberNavItems = [");
  expect(start).toBeGreaterThanOrEqual(0);
  const end = SIDEBAR.indexOf("];", start);
  expect(end).toBeGreaterThan(start);
  return SIDEBAR.slice(start, end);
}

describe("member sidebar nav", () => {
  it("lists exactly the 5 member pages in order", () => {
    const block = memberNavBlock();
    const hrefs = [...block.matchAll(/href: "([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual([
      "/dashboard/member",
      "/dashboard/endpoint",
      "/dashboard/usage",
      "/dashboard/quota",
      "/dashboard/cli-tools",
    ]);
  });

  it("uses the same labels and icons as the admin sidebar", () => {
    const block = memberNavBlock();
    for (const [label, icon] of [
      ["Dashboard Member", "person"],
      ["Endpoint & Key", "api"],
      ["Usage", "bar_chart"],
      ["Quota Tracker", "data_usage"],
      ["CLI Tools", "terminal"],
    ]) {
      expect(block).toContain(`label: "${label}"`);
      expect(block).toContain(`icon: "${icon}"`);
    }
  });

  it("contains no admin-only page", () => {
    const block = memberNavBlock();
    for (const href of [
      "/dashboard/providers",
      "/dashboard/combos",
      "/dashboard/token-saver",
      "/dashboard/scanner",
      "/dashboard/key-usage",
      "/dashboard/traffic",
      "/dashboard/conversations",
      "/dashboard/playground",
      "/dashboard/members",
      "/dashboard/compensations",
      "/dashboard/rebrand",
      "/dashboard/settings",
    ]) {
      expect(block).not.toContain(href);
    }
  });
});
