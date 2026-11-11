import { describe, it, expect, beforeAll } from "vitest";

// Real-module tests (no mocks): session role round-trip, guard allow-lists,
// and the member usage aggregation. Isolated from the real DATA_DIR via env
// set before the dynamic imports below.
let session;
let guard;
let usageRepo;

beforeAll(async () => {
  process.env.JWT_SECRET = "vitest-test-secret-only";
  process.env.DATA_DIR = "/tmp/9router-vitest-member";
  session = await import("../../src/lib/auth/dashboardSession.js");
  guard = await import("../../src/dashboardGuard.js");
  usageRepo = await import("../../src/lib/db/repos/usageRepo.js");
});

describe("dashboard session roles", () => {
  it("getSessionRole: null -> null, member -> member, no role -> admin", () => {
    expect(session.getSessionRole(null)).toBeNull();
    expect(session.getSessionRole({ role: "member" })).toBe("member");
    expect(session.getSessionRole({ authenticated: true })).toBe("admin");
    expect(session.getSessionRole({ role: "admin" })).toBe("admin");
  });

  it("round-trips a member role claim through a real JWT (24h HS256)", async () => {
    const token = await session.createDashboardAuthToken({
      role: "member",
      memberId: "m-1",
      keyId: "k-1",
      memberName: "Budi",
    });
    expect(await session.verifyDashboardAuthToken(token)).toBe(true);

    const payload = await session.getDashboardAuthSession(token);
    expect(payload.role).toBe("member");
    expect(payload.memberId).toBe("m-1");
    expect(payload.keyId).toBe("k-1");
    expect(session.getSessionRole(payload)).toBe("member");
  });

  it("admin token without a role claim still verifies as admin", async () => {
    const token = await session.createDashboardAuthToken({ role: "admin" });
    const payload = await session.getDashboardAuthSession(token);
    expect(session.getSessionRole(payload)).toBe("admin");
  });
});

describe("member guard allow-lists (dashboardGuard.__test__)", () => {
  it("allows members only their own API routes (GET)", () => {
    const { isMemberAllowedApiPath } = guard.__test__;
    expect(isMemberAllowedApiPath("/api/keys", "GET")).toBe(true);
    expect(isMemberAllowedApiPath("/api/keys/k-1", "GET")).toBe(true);
    expect(isMemberAllowedApiPath("/api/usage/history", "GET")).toBe(true);
    expect(isMemberAllowedApiPath("/api/usage/stats", "GET")).toBe(true);
    expect(isMemberAllowedApiPath("/api/auth/status", "GET")).toBe(true);
    expect(isMemberAllowedApiPath("/api/auth/logout", "POST")).toBe(true);
  });

  it("blocks members from admin API routes and writes", () => {
    const { isMemberAllowedApiPath } = guard.__test__;
    expect(isMemberAllowedApiPath("/api/keys", "POST")).toBe(false);
    expect(isMemberAllowedApiPath("/api/keys/k-1", "DELETE")).toBe(false);
    expect(isMemberAllowedApiPath("/api/settings", "GET")).toBe(false);
    expect(isMemberAllowedApiPath("/api/members", "GET")).toBe(false);
    expect(isMemberAllowedApiPath("/api/members/m-1", "PATCH")).toBe(false);
    expect(isMemberAllowedApiPath("/api/auth/logout", "GET")).toBe(false);
    // NOTE (member menu expansion, 2026-11-11): /api/providers GET and
    // /api/usage/chart GET are now member-allowed reads (member-safe
    // projection / member-scoped aggregation); they moved to the allow test
    // in dashboard-guard.test.js.
  });

  it("allows members the 5 member dashboard pages (menu revised 2026-11-11)", () => {
    const { isMemberAllowedDashboardPath } = guard.__test__;
    for (const p of [
      "/dashboard/member",
      "/dashboard/endpoint",
      "/dashboard/usage",
      "/dashboard/quota",
      "/dashboard/cli-tools",
      "/dashboard/cli-tools/claude",
    ]) {
      expect(isMemberAllowedDashboardPath(p)).toBe(true);
    }
    expect(isMemberAllowedDashboardPath("/dashboard")).toBe(false);
    expect(isMemberAllowedDashboardPath("/dashboard/members")).toBe(false);
    // Providers, combos, and token-saver are admin-only (user correction).
    expect(isMemberAllowedDashboardPath("/dashboard/providers")).toBe(false);
    expect(isMemberAllowedDashboardPath("/dashboard/combos")).toBe(false);
    expect(isMemberAllowedDashboardPath("/dashboard/token-saver")).toBe(false);
    // No such page: /dashboard/member has no subpages (exact match), and
    // the provider detail page stays admin-only.
    expect(isMemberAllowedDashboardPath("/dashboard/member/usage")).toBe(false);
    expect(isMemberAllowedDashboardPath("/dashboard/providers/abc")).toBe(false);
  });
});

describe("buildMemberUsageStats (pure aggregation)", () => {
  const rows = [
    { timestamp: new Date().toISOString(), provider: "codebuddy", model: "gpt-5", apiKey: "h-router-aaa", endpoint: "/v1/chat/completions", promptTokens: 100, completionTokens: 50, cost: 0.01, tokens: null, status: "ok" },
    { timestamp: new Date().toISOString(), provider: "codebuddy", model: "gpt-5", apiKey: "h-router-aaa", endpoint: "/v1/chat/completions", promptTokens: 200, completionTokens: 100, cost: 0.02, tokens: null, status: "ok" },
    { timestamp: new Date().toISOString(), provider: "gemini", model: "gemini-3", apiKey: "h-router-aaa", endpoint: "/v1/chat/completions", promptTokens: 10, completionTokens: 5, cost: 0.001, tokens: null, status: "ok" },
  ];

  it("aggregates only the rows it is given (member filtering happens in SQL)", () => {
    const stats = usageRepo.buildMemberUsageStats(rows, { "h-router-aaa": "Budi key" });
    expect(stats.totalRequests).toBe(3);
    expect(stats.totalPromptTokens).toBe(310);
    expect(stats.totalCompletionTokens).toBe(155);
    expect(stats.totalCost).toBeCloseTo(0.031);
    expect(stats.byProvider.codebuddy.requests).toBe(2);
    expect(stats.byProvider.gemini.requests).toBe(1);
    expect(stats.byModel["gpt-5 (codebuddy)"].requests).toBe(2);
    expect(stats.byModel["gemini-3 (gemini)"].requests).toBe(1);
    expect(stats.recentRequests).toHaveLength(3);
    expect(stats.last10Minutes).toHaveLength(10);
  });

  it("returns empty stats for an empty row set", () => {
    const stats = usageRepo.buildMemberUsageStats([], {});
    expect(stats.totalRequests).toBe(0);
    expect(stats.totalCost).toBe(0);
    expect(stats.byProvider).toEqual({});
    expect(stats.recentRequests).toEqual([]);
    expect(stats.last10Minutes).toHaveLength(10);
  });

  it("caps recentRequests at 20, newest first", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      timestamp: new Date(Date.now() - i * 1000).toISOString(),
      provider: "p", model: "m", apiKey: "h-router-aaa", endpoint: "/v1/x",
      promptTokens: 1, completionTokens: 1, cost: 0, tokens: null, status: "ok",
    }));
    const stats = usageRepo.buildMemberUsageStats(many, {});
    expect(stats.totalRequests).toBe(25);
    expect(stats.recentRequests).toHaveLength(20);
    expect(new Date(stats.recentRequests[0].timestamp) >= new Date(stats.recentRequests[1].timestamp)).toBe(true);
  });
});
