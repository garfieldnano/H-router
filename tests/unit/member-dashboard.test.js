import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  cookies: vi.fn(),
  // localDb
  getApiKeys: vi.fn(),
  getApiKeysByMemberId: vi.fn(),
  createApiKey: vi.fn(),
  getApiKeyById: vi.fn(),
  updateApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  validateApiKey: vi.fn(),
  getApiKeyByKey: vi.fn(),
  getMemberById: vi.fn(),
  getMemberByEmail: vi.fn(),
  getMembers: vi.fn(),
  createMember: vi.fn(),
  // usageDb
  getUsageStats: vi.fn(),
  getMemberUsageStats: vi.fn(),
  sanitizeUsageStatsForBrowser: vi.fn((s) => s),
  // memberAuth
  getRequestMemberSession: vi.fn(),
  // dashboardSession (member-login route only)
  setDashboardAuthCookie: vi.fn(),
  // keyRateLimit service (RPM status attached by /api/keys)
  getKeyRateStatus: vi.fn(),
  // keyIpCap service (IP status attached by /api/keys)
  getKeyIpStatus: vi.fn(),
  // loginLimiter
  checkLock: vi.fn(),
  recordFail: vi.fn(),
  recordSuccess: vi.fn(),
  getClientIp: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: mocks.json },
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
}));

vi.mock("@/lib/localDb", () => ({
  getApiKeys: mocks.getApiKeys,
  getApiKeysByMemberId: mocks.getApiKeysByMemberId,
  createApiKey: mocks.createApiKey,
  getApiKeyById: mocks.getApiKeyById,
  updateApiKey: mocks.updateApiKey,
  deleteApiKey: mocks.deleteApiKey,
  validateApiKey: mocks.validateApiKey,
  getApiKeyByKey: mocks.getApiKeyByKey,
  getMemberById: mocks.getMemberById,
  getMemberByEmail: mocks.getMemberByEmail,
  getMembers: mocks.getMembers,
  createMember: mocks.createMember,
}));

vi.mock("@/lib/usageDb", () => ({
  getUsageStats: mocks.getUsageStats,
  getMemberUsageStats: mocks.getMemberUsageStats,
  sanitizeUsageStatsForBrowser: mocks.sanitizeUsageStatsForBrowser,
}));

vi.mock("@/lib/auth/memberAuth", () => ({
  getRequestMemberSession: mocks.getRequestMemberSession,
}));

vi.mock("@/lib/auth/dashboardSession", () => ({
  setDashboardAuthCookie: mocks.setDashboardAuthCookie,
}));

vi.mock("@/lib/auth/loginLimiter", () => ({
  checkLock: mocks.checkLock,
  recordFail: mocks.recordFail,
  recordSuccess: mocks.recordSuccess,
  getClientIp: mocks.getClientIp,
}));

vi.mock("@/sse/services/keyRateLimit.js", () => ({
  getKeyRateStatus: mocks.getKeyRateStatus,
}));

vi.mock("@/sse/services/keyIpCap.js", () => ({
  getKeyIpStatus: mocks.getKeyIpStatus,
}));

const keysRoute = await import("../../src/app/api/keys/route.js");
const keyByIdRoute = await import("../../src/app/api/keys/[id]/route.js");
const usageHistoryRoute = await import("../../src/app/api/usage/history/route.js");
const membersRoute = await import("../../src/app/api/members/route.js");
const memberLoginRoute = await import("../../src/app/api/auth/member-login/route.js");

const MEMBER = { role: "member", memberId: "m-1", keyId: "k-1", memberName: "Budi" };
const OWN_KEY = { id: "k-1", key: "h-router-0123456789abcdef-abc123-deadbeef", name: "Budi key", memberId: "m-1", isActive: true, createdAt: "2026-11-10T00:00:00.000Z" };
const OTHER_KEY = { id: "k-2", key: "h-router-0123456789abcdef-xyz789-12345678", name: "Other key", memberId: "m-2", isActive: true, createdAt: "2026-11-10T00:00:00.000Z" };
// Canned RPM status returned by the mocked keyRateLimit service.
const RATE = { keyId: "k-1", limit: 50, source: "global", packageId: null, packageName: null, used: 0, remaining: 50, resetAtMs: 1800000000000 };
// Canned IP status returned by the mocked keyIpCap service.
const IP = { keyId: "k-1", cap: 3, source: "default", activeCount: 0, activeIps: [], resetAtMs: 1800000000000 };

function req(url, body) {
  return {
    url,
    headers: new Headers(),
    json: async () => body || {},
  };
}

describe("GET /api/keys (member scoping)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestMemberSession.mockResolvedValue(null);
    mocks.getApiKeys.mockResolvedValue([OWN_KEY, OTHER_KEY]);
    mocks.getApiKeysByMemberId.mockResolvedValue([OWN_KEY]);
    mocks.getKeyRateStatus.mockResolvedValue(RATE);
    mocks.getKeyIpStatus.mockResolvedValue(IP);
  });

  it("member sees ONLY their own keys", async () => {
    mocks.getRequestMemberSession.mockResolvedValue(MEMBER);
    const res = await keysRoute.GET();
    expect(res.status).toBe(200);
    expect(res.body.keys).toEqual([{ ...OWN_KEY, rate: RATE, ip: IP }]);
    expect(mocks.getApiKeysByMemberId).toHaveBeenCalledWith("m-1");
    expect(mocks.getApiKeys).not.toHaveBeenCalled();
  });

  it("admin sees all keys", async () => {
    const res = await keysRoute.GET();
    expect(res.body.keys).toEqual([{ ...OWN_KEY, rate: RATE, ip: IP }, { ...OTHER_KEY, rate: RATE, ip: IP }]);
    expect(mocks.getApiKeys).toHaveBeenCalled();
  });

  it("member cannot create a key (POST -> 403)", async () => {
    mocks.getRequestMemberSession.mockResolvedValue(MEMBER);
    const res = await keysRoute.POST(req("http://x/api/keys", { name: "x" }));
    expect(res.status).toBe(403);
    expect(mocks.createApiKey).not.toHaveBeenCalled();
  });
});

describe("GET/PUT/DELETE /api/keys/[id] (member scoping)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestMemberSession.mockResolvedValue(null);
    mocks.getKeyRateStatus.mockResolvedValue(RATE);
    mocks.getKeyIpStatus.mockResolvedValue(IP);
  });

  it("member reading another member's key gets 404 (no leak)", async () => {
    mocks.getRequestMemberSession.mockResolvedValue(MEMBER);
    mocks.getApiKeyById.mockResolvedValue(OTHER_KEY);
    const res = await keyByIdRoute.GET(req("http://x/api/keys/k-2"), { params: Promise.resolve({ id: "k-2" }) });
    expect(res.status).toBe(404);
  });

  it("member reading their own key gets 200", async () => {
    mocks.getRequestMemberSession.mockResolvedValue(MEMBER);
    mocks.getApiKeyById.mockResolvedValue(OWN_KEY);
    const res = await keyByIdRoute.GET(req("http://x/api/keys/k-1"), { params: Promise.resolve({ id: "k-1" }) });
    expect(res.status).toBe(200);
    expect(res.body.key).toEqual({ ...OWN_KEY, rate: RATE, ip: IP });
  });

  it("member cannot update a key (PUT -> 403)", async () => {
    mocks.getRequestMemberSession.mockResolvedValue(MEMBER);
    const res = await keyByIdRoute.PUT(req("http://x/api/keys/k-1", { isActive: false }), { params: Promise.resolve({ id: "k-1" }) });
    expect(res.status).toBe(403);
    expect(mocks.updateApiKey).not.toHaveBeenCalled();
  });

  it("member cannot delete a key (DELETE -> 403)", async () => {
    mocks.getRequestMemberSession.mockResolvedValue(MEMBER);
    const res = await keyByIdRoute.DELETE(req("http://x/api/keys/k-1"), { params: Promise.resolve({ id: "k-1" }) });
    expect(res.status).toBe(403);
    expect(mocks.deleteApiKey).not.toHaveBeenCalled();
  });
});

describe("GET /api/usage/history (member scoping)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestMemberSession.mockResolvedValue(null);
    mocks.getUsageStats.mockResolvedValue({ totalRequests: 100 });
    mocks.getMemberUsageStats.mockResolvedValue({ totalRequests: 3 });
    mocks.getApiKeysByMemberId.mockResolvedValue([OWN_KEY]);
  });

  it("member gets stats computed only from their own keys", async () => {
    mocks.getRequestMemberSession.mockResolvedValue(MEMBER);
    const res = await usageHistoryRoute.GET(req("http://x/api/usage/history?period=today"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ totalRequests: 3 });
    expect(mocks.getMemberUsageStats).toHaveBeenCalledWith([OWN_KEY.key], "today");
    expect(mocks.getUsageStats).not.toHaveBeenCalled();
  });

  it("admin gets the full stats", async () => {
    const res = await usageHistoryRoute.GET(req("http://x/api/usage/history?period=7d"));
    expect(res.body).toEqual({ totalRequests: 100 });
    expect(mocks.getUsageStats).toHaveBeenCalledWith("7d");
    expect(mocks.getMemberUsageStats).not.toHaveBeenCalled();
  });

  it("rejects an invalid period", async () => {
    const res = await usageHistoryRoute.GET(req("http://x/api/usage/history?period=banana"));
    expect(res.status).toBe(400);
  });
});

describe("GET/POST /api/members (admin only)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestMemberSession.mockResolvedValue(null);
    mocks.getMembers.mockResolvedValue([{ id: "m-1", name: "Budi", email: "budi@example.com", isActive: true, createdAt: "2026-11-10T00:00:00.000Z" }]);
    mocks.getApiKeys.mockResolvedValue([OWN_KEY, OTHER_KEY]);
    mocks.getMemberByEmail.mockResolvedValue(null);
    mocks.createMember.mockResolvedValue({ id: "m-3", name: "Cici", email: "cici@example.com", isActive: true, createdAt: "2026-11-10T00:00:00.000Z" });
  });

  it("member cannot list members (GET -> 403)", async () => {
    mocks.getRequestMemberSession.mockResolvedValue(MEMBER);
    const res = await membersRoute.GET();
    expect(res.status).toBe(403);
  });

  it("admin lists members with their assigned keys", async () => {
    const res = await membersRoute.GET();
    expect(res.status).toBe(200);
    expect(res.body.members[0].keys).toHaveLength(1);
    expect(res.body.members[0].keys[0].id).toBe("k-1");
    expect(res.body.unassignedKeys).toHaveLength(0);
  });

  it("member cannot create a member (POST -> 403)", async () => {
    mocks.getRequestMemberSession.mockResolvedValue(MEMBER);
    const res = await membersRoute.POST(req("http://x/api/members", { name: "X", email: "x@example.com" }));
    expect(res.status).toBe(403);
    expect(mocks.createMember).not.toHaveBeenCalled();
  });

  it("admin creates a member", async () => {
    const res = await membersRoute.POST(req("http://x/api/members", { name: "Cici", email: "cici@example.com" }));
    expect(res.status).toBe(201);
    expect(res.body.member.email).toBe("cici@example.com");
    expect(mocks.createMember).toHaveBeenCalledWith({ name: "Cici", email: "cici@example.com" });
  });

  it("duplicate email is rejected (409)", async () => {
    mocks.getMemberByEmail.mockResolvedValue({ id: "m-1", email: "budi@example.com" });
    const res = await membersRoute.POST(req("http://x/api/members", { name: "Budi", email: "budi@example.com" }));
    expect(res.status).toBe(409);
    expect(mocks.createMember).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/member-login (API-key login)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookies.mockResolvedValue({ set: vi.fn(), get: vi.fn() });
    mocks.checkLock.mockReturnValue({ locked: false });
    mocks.getClientIp.mockReturnValue("127.0.0.1");
    mocks.validateApiKey.mockResolvedValue(true);
    mocks.getApiKeyByKey.mockResolvedValue(OWN_KEY);
    mocks.getMemberById.mockResolvedValue({ id: "m-1", name: "Budi", email: "budi@example.com", isActive: true });
  });

  it("valid assigned key logs the member in and issues a member session", async () => {
    const res = await memberLoginRoute.POST(req("http://x/api/auth/member-login", { apiKey: OWN_KEY.key }));
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("member");
    expect(res.body.memberId).toBe("m-1");
    expect(mocks.setDashboardAuthCookie).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { role: "member", memberId: "m-1", keyId: "k-1", memberName: "Budi" }
    );
  });

  it("invalid key -> 401", async () => {
    mocks.validateApiKey.mockResolvedValue(false);
    const res = await memberLoginRoute.POST(req("http://x/api/auth/member-login", { apiKey: "h-router-bad" }));
    expect(res.status).toBe(401);
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });

  it("key without a member -> 403", async () => {
    mocks.getApiKeyByKey.mockResolvedValue({ ...OWN_KEY, memberId: null });
    const res = await memberLoginRoute.POST(req("http://x/api/auth/member-login", { apiKey: OWN_KEY.key }));
    expect(res.status).toBe(403);
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });

  it("inactive member -> 403", async () => {
    mocks.getMemberById.mockResolvedValue({ id: "m-1", name: "Budi", isActive: false });
    const res = await memberLoginRoute.POST(req("http://x/api/auth/member-login", { apiKey: OWN_KEY.key }));
    expect(res.status).toBe(403);
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });

  it("missing key -> 400", async () => {
    const res = await memberLoginRoute.POST(req("http://x/api/auth/member-login", {}));
    expect(res.status).toBe(400);
  });
});
