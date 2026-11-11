// Daily digest aggregation tests: totals, top-model ranking, member/key
// ranking, and Asia/Jakarta day-boundary handling (WIB = UTC+7, no DST).
import { describe, it, expect } from "vitest";
import {
  getWibDayBounds, getPreviousWibDayBounds, msUntilNextDigest,
  buildDailyDigest, buildMemberDailyReport, renderDailyDigest, renderMemberDailyReport,
} from "../../src/lib/bot/digest.mjs";

const keyMeta = {
  "h-router-aaaaaaaaaaaaaaaa-bbbbbb-cccccccc": { memberId: "m1", memberName: "Andi", keyName: "Key Andi" },
  "h-router-dddddddddddddddd-eeeeee-ffffffff": { memberId: "m2", memberName: "Budi", keyName: "Key Budi" },
};

function row(over = {}) {
  return {
    apiKey: "h-router-aaaaaaaaaaaaaaaa-bbbbbb-cccccccc",
    model: "openai/gpt-5",
    promptTokens: 100, completionTokens: 50, cost: 0.01,
    timestamp: "2026-11-09T10:00:00.000Z", status: "ok",
    ...over,
  };
}

describe("WIB day bounds", () => {
  it("WIB midnight is 17:00 UTC the previous day", () => {
    // 2026-11-10 00:30 WIB == 2026-11-09 17:30 UTC
    const b = getWibDayBounds(new Date("2026-11-09T17:30:00.000Z"));
    expect(b.label).toBe("2026-11-10");
    expect(b.start).toBe("2026-11-09T17:00:00.000Z");
    expect(b.end).toBe("2026-11-10T17:00:00.000Z");
  });
  it("23:59 WIB belongs to the same WIB day, 00:00 belongs to the next", () => {
    const before = getWibDayBounds(new Date("2026-11-09T16:59:59.000Z")); // 23:59:59 WIB Nov 9
    const after = getWibDayBounds(new Date("2026-11-09T17:00:00.000Z")); // 00:00:00 WIB Nov 10
    expect(before.label).toBe("2026-11-09");
    expect(after.label).toBe("2026-11-10");
    // A row at 16:59:59Z is inside the Nov-9 window, a row at 17:00:00Z is not.
    expect("2026-11-09T16:59:59.000Z" >= before.start && "2026-11-09T16:59:59.000Z" < before.end).toBe(true);
    expect("2026-11-09T17:00:00.000Z" >= before.start && "2026-11-09T17:00:00.000Z" < before.end).toBe(false);
    expect("2026-11-09T17:00:00.000Z" >= after.start && "2026-11-09T17:00:00.000Z" < after.end).toBe(true);
  });
  it("previous WIB day from a morning timestamp", () => {
    const b = getPreviousWibDayBounds(new Date("2026-11-10T01:00:00.000Z")); // 08:00 WIB Nov 10
    expect(b.label).toBe("2026-11-09");
    expect(b.start).toBe("2026-11-08T17:00:00.000Z");
    expect(b.end).toBe("2026-11-09T17:00:00.000Z");
  });
  it("msUntilNextDigest: 07:00 WIB -> ~60 min; 09:00 WIB -> ~23 h", () => {
    const to7 = msUntilNextDigest(new Date("2026-11-09T00:00:00.000Z")); // 07:00 WIB
    expect(to7).toBe(60 * 60 * 1000);
    const to9 = msUntilNextDigest(new Date("2026-11-09T02:00:00.000Z")); // 09:00 WIB
    expect(to9).toBe(23 * 60 * 60 * 1000);
  });
});

describe("buildDailyDigest", () => {
  it("totals with prompt/completion split + ok/error split", () => {
    const d = buildDailyDigest([
      row(),
      row({ promptTokens: 200, completionTokens: 100, cost: 0.02 }),
      row({ status: "error", cost: 0 }),
    ], keyMeta, { label: "2026-11-09" });
    expect(d.requests).toBe(3);
    expect(d.okRequests).toBe(2);
    expect(d.errorRequests).toBe(1);
    expect(d.promptTokens).toBe(400);
    expect(d.completionTokens).toBe(200);
    expect(d.tokens).toBe(600);
    expect(d.cost).toBeCloseTo(0.03, 10);
  });
  it("top models ranked by requests, then tokens", () => {
    const d = buildDailyDigest([
      row({ model: "a/x", promptTokens: 10, completionTokens: 5 }),
      row({ model: "b/y", promptTokens: 1000, completionTokens: 500 }),
      row({ model: "b/y", promptTokens: 1000, completionTokens: 500 }),
      row({ model: "c/z", promptTokens: 5, completionTokens: 5 }),
    ], keyMeta, { label: "2026-11-09" });
    expect(d.topModels.map((m) => m.model)).toEqual(["b/y", "a/x", "c/z"]);
    expect(d.topModels[0].requests).toBe(2);
    expect(d.topModels[0].tokens).toBe(3000);
  });
  it("top members and keys resolved through keyMeta", () => {
    const d = buildDailyDigest([
      row(),
      row({ apiKey: "h-router-dddddddddddddddd-eeeeee-ffffffff", model: "a/x" }),
      row({ apiKey: "h-router-dddddddddddddddd-eeeeee-ffffffff", model: "a/x" }),
    ], keyMeta, { label: "2026-11-09" });
    expect(d.topMembers[0].memberName).toBe("Budi");
    expect(d.topMembers[0].requests).toBe(2);
    expect(d.topKeys[0].key).toBe("Key Budi");
    expect(d.topKeys[0].requests).toBe(2);
  });
  it("empty day renders an explicit empty state", () => {
    const d = buildDailyDigest([], keyMeta, { label: "2026-11-09" });
    expect(d.requests).toBe(0);
    expect(renderDailyDigest(d)).toMatch(/Tidak ada request/);
  });
  it("render includes totals + top sections", () => {
    const d = buildDailyDigest([row(), row({ model: "b/y" })], keyMeta, { label: "2026-11-09" });
    const text = renderDailyDigest(d);
    expect(text).toContain("Laporan Harian — 2026-11-09");
    expect(text).toContain("Total request: 2");
    expect(text).toContain("Top model");
    expect(text).toContain("Member teraktif");
  });
});

describe("buildMemberDailyReport", () => {
  it("per-model breakdown for one member's rows", () => {
    const r = buildMemberDailyReport([
      row({ model: "a/x", promptTokens: 10, completionTokens: 5, cost: 0.001 }),
      row({ model: "a/x", promptTokens: 20, completionTokens: 10, cost: 0.002 }),
      row({ model: "b/y", promptTokens: 100, completionTokens: 50, cost: 0.01 }),
    ], { label: "2026-11-10" });
    expect(r.requests).toBe(3);
    expect(r.tokens).toBe(195);
    expect(r.models[0].model).toBe("a/x"); // 2 requests beats 1
    expect(r.models[0].requests).toBe(2);
    const text = renderMemberDailyReport(r);
    expect(text).toContain("Laporan Harian — 2026-11-10");
    expect(text).toContain("a/x: 2 req");
  });
  it("empty member day", () => {
    const r = buildMemberDailyReport([], { label: "2026-11-10" });
    expect(r.requests).toBe(0);
    expect(renderMemberDailyReport(r)).toMatch(/Belum ada request/);
  });
});
