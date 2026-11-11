import { NextResponse } from "next/server";
import { getSettings, validateApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { verifyDashboardAuthToken, getDashboardAuthSession, getSessionRole } from "@/lib/auth/dashboardSession";
import { hasTrustedPeerHeaders } from "@/lib/auth/trustedPeer";

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const CLI_TOKEN_SALT = "9r-cli-auth";

let cachedCliToken = null;
async function getCliToken() {
  if (!cachedCliToken) cachedCliToken = await getConsistentMachineId(CLI_TOKEN_SALT);
  return cachedCliToken;
}

async function hasValidCliToken(request) {
  const token = request.headers.get(CLI_TOKEN_HEADER);
  if (!token) return false;
  return token === await getCliToken();
}

// Public API paths — no auth required (LLM API has its own key auth inside handler).
const PUBLIC_API_PATHS = [
  "/api/health",
  "/api/init",
  "/api/locale",
  "/api/auth/login",
  "/api/auth/member-login",
  "/api/auth/logout",
  "/api/auth/status",
  "/api/auth/oidc",
  "/api/auth/saml",
  "/api/version",
  "/api/settings/require-login",
];

// Public top-level prefixes (LLM API endpoints with their own API key auth).
// Keep root-level rewrites here too: middleware runs before Next.js rewrites.
// "/api/bot" is the Telegram bot's internal API — it passes the guard here
// and enforces its own service secret (HROUTER_BOT_SECRET) in each route.
const PUBLIC_PREFIXES = ["/v1", "/v1beta", "/api/v1", "/api/v1beta", "/codex", "/responses", "/api/bot"];

// Always require JWT token regardless of requireLogin setting
const ALWAYS_PROTECTED = [
  "/api/shutdown",
  "/api/settings/database",
  "/api/version/shutdown",
  "/api/version/update",
  "/api/oauth/cursor/auto-import",
  "/api/oauth/kiro/auto-import",
  "/api/oauth/zed/auto-import",
  "/api/oauth/minimax-code/lease",
  "/api/oauth/minimax-code-global/lease",
];

// Require auth, but allow through if requireLogin is disabled
const PROTECTED_API_PATHS = [
  "/api/settings",
  "/api/keys",
  "/api/providers",
  "/api/provider-nodes",
  "/api/proxy-pools",
  "/api/combos",
  "/api/models",
  "/api/usage",
  "/api/oauth",
  "/api/cloud",
  "/api/media-providers",
  "/api/pricing",
  "/api/tags",
  "/api/cli-tools",
  "/api/mcp",
  "/api/translator",
  "/api/tunnel",
  "/api/packages",
  "/api/model-brands",
  "/api/live-prompts",
  "/api/vision-overrides",
];

// Routes that spawn child processes or read host secrets — restrict to localhost.
const LOCAL_ONLY_PATHS = [
  "/api/cli-tools/cowork-settings",
  "/api/cli-tools/antigravity-mitm",
  "/api/mcp/",
  "/api/tunnel/tailscale-install",
  "/api/tunnel/tailscale-enable",
  "/api/tunnel/tailscale-disable",
  "/api/tunnel/tailscale-check",
  "/api/tunnel/enable",
  "/api/tunnel/disable",
  "/api/oauth/cursor/auto-import",
  "/api/oauth/kiro/auto-import",
  "/api/oauth/zed/auto-import",
  "/api/oauth/minimax-code/lease",
  "/api/oauth/minimax-code-global/lease",
  "/api/auth/reset-password",
  "/api/headroom/start",
  "/api/headroom/stop",
  "/api/headroom/proxy",
];

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

// Accepts a Host header, a URL hostname or a raw socket address. Splitting on the first
// colon only works for IPv4 and would reduce every IPv6 form to "", so a dual-stack
// listener handing back ::ffff:127.0.0.1 would not read as loopback.
function isLoopbackHostname(h) {
  if (!h) return false;
  let name = String(h).trim().toLowerCase();
  if (name.startsWith("[")) {
    const end = name.indexOf("]");
    if (end === -1) return false;
    name = name.slice(1, end);
  } else if (name.indexOf(":") !== -1 && name.indexOf(":") === name.lastIndexOf(":")) {
    name = name.slice(0, name.indexOf(":"));
  }
  if (name.startsWith("::ffff:")) name = name.slice(7);
  return LOOPBACK_HOSTS.has(name);
}

function isLoopbackPeer(request) {
  if (hasTrustedPeerHeaders(request)) {
    return isLoopbackHostname(request.headers.get("x-9r-real-ip"));
  }
  // Bare `next dev` forks its server, so the wrapper never loads and no peer address
  // reaches us. Host is spoofable, so this stays confined to development.
  if (process.env.NODE_ENV === "development") {
    return isLoopbackHostname(request.headers.get("host"));
  }
  return false;
}

export function isLocalRequest(request) {
  // Stamped by custom-server.js when forwarding headers exist: request came through
  // a reverse proxy, so the loopback socket is the proxy hop, not the end-user.
  if (request.headers.get("x-9r-via-proxy")) return false;
  if (!isLoopbackPeer(request)) return false;
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (!isLoopbackHostname(new URL(origin).hostname)) return false;
    } catch { return false; }
  }
  return true;
}

function isPublicLlmApi(pathname) {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function extractApiKey(request) {
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  const apiKeyHeader = request.headers.get("x-api-key");
  if (apiKeyHeader) return apiKeyHeader;
  const googleApiKeyHeader = request.headers.get("x-goog-api-key");
  if (googleApiKeyHeader) return googleApiKeyHeader;
  return request.nextUrl.searchParams?.get("key") || null;
}

async function hasValidApiKey(request) {
  const apiKey = extractApiKey(request);
  if (!apiKey) return false;
  return await validateApiKey(apiKey);
}

async function canAccessPublicLlmApi(request) {
  if (isLocalRequest(request)) return true;
  if (await hasValidCliToken(request)) return true;
  return await hasValidApiKey(request);
}

async function canAccessLocalOnlyRoute(request) {
  if (await hasValidCliToken(request)) return true;
  // Browser on host: loopback Host + Origin (blocks tunnel/CSRF) + auth (JWT or requireLogin=false)
  if (isLocalRequest(request) && await isAuthenticated(request)) return true;
  return false;
}

async function hasValidToken(request) {
  const token = request.cookies.get("auth_token")?.value;
  return await verifyDashboardAuthToken(token);
}

// Read settings directly from DB to avoid self-fetch deadlock in proxy
async function loadSettings() {
  try {
    return await getSettings();
  } catch {
    return null;
  }
}

async function isAuthenticated(request) {
  if (await hasValidToken(request)) return true;
  const settings = await loadSettings();
  if (settings && settings.requireLogin === false) return true;
  return false;
}

// --- Member dashboard (v1) role split -------------------------------------
// A member session (JWT role "member") may only reach its own dashboard page
// and the API routes that serve it. Everything else under /dashboard and
// /api/* stays admin-only. This guard is defense in depth: the API routes
// themselves enforce member scoping too (filtering by the caller's memberId).

// API routes a member session may call (method + exact/prefix match).
// Member dashboard expansion (2026-11-11): members also get 4 extra pages
// (endpoint, usage, quota, cli-tools) in READ-ONLY form. Only the GET
// endpoints those pages need are listed here; every route must still scope
// by the caller's memberId server-side, and all mutations stay blocked by
// this allow-list (403). Providers, Combo & Vision Adapter, and Token Saver
// are admin-only (user correction 2026-11-11): their pages are not in the
// member dashboard prefixes, and their dedicated endpoints (/api/combos*,
// /api/models, /api/vision-adapter/status, /api/token-saver/status) are NOT
// listed here. NOTE: /api/providers + /api/provider-nodes STAY because the
// member Usage page (UsageStats provider filter) and the CLI tool cards
// call them; /api/providers strips secrets for members server-side, so
// keeping them does not expose provider credentials. /api/models/alias
// stays for the same reason (CLI tool cards + KeyAccessControls).
const MEMBER_API_PATHS = [
  { path: "/api/auth/status", methods: ["GET"] },
  { path: "/api/auth/logout", methods: ["POST"] },
  { path: "/api/auth/telegram-link", methods: ["POST"] },
  { path: "/api/keys", methods: ["GET"] },
  { path: "/api/usage/history", methods: ["GET"] },
  { path: "/api/usage/stats", methods: ["GET"] },
  // Member's own compensation history (§0d) — the route scopes by session.
  { path: "/api/compensations", methods: ["GET"] },
  // Usage page tabs — routes scope by session memberId (see each route).
  { path: "/api/usage/stream", methods: ["GET"] },
  { path: "/api/usage/request-logs", methods: ["GET"] },
  { path: "/api/usage/request-details", methods: ["GET"] },
  { path: "/api/usage/providers", methods: ["GET"] },
  { path: "/api/usage/chart", methods: ["GET"] },
  // Usage page provider filter (UsageStats) — member-safe projection:
  // /api/providers strips secrets and, for members, additionally drops
  // providerSpecificData + account email.
  { path: "/api/providers", methods: ["GET"] },
  { path: "/api/provider-nodes", methods: ["GET"] },
  // CLI tool cards read the model alias list (read-only, no secrets).
  { path: "/api/models/alias", methods: ["GET"] },
  // CLI tools + endpoint pages.
  { path: "/api/tunnel/status", methods: ["GET"] },
  { path: "/api/cli-tools/all-statuses", methods: ["GET"] },
];

// Member dashboard pages.
const MEMBER_DASHBOARD_PREFIXES = [
  "/dashboard/member",
  "/dashboard/endpoint",
  "/dashboard/usage",
  "/dashboard/quota",
  "/dashboard/cli-tools",
];

// Of the prefixes above, only these also allow subpaths for members.
const MEMBER_DASHBOARD_SUBPATH_PREFIXES = ["/dashboard/cli-tools"];

export function isMemberAllowedApiPath(pathname, method = "GET") {
  return MEMBER_API_PATHS.some(
    (entry) =>
      (pathname === entry.path || pathname.startsWith(`${entry.path}/`)) &&
      entry.methods.includes(String(method || "GET").toUpperCase())
  );
}

export function isMemberAllowedDashboardPath(pathname) {
  // Exact match for the member pages, except the prefixes in
  // MEMBER_DASHBOARD_SUBPATH_PREFIXES whose subpaths are also member pages
  // (/dashboard/cli-tools/[toolId] is part of the member CLI setup flow).
  // Providers, combos, and token-saver are admin-only (not in the prefixes
  // above), so members are redirected to /dashboard/member for those URLs.
  return MEMBER_DASHBOARD_PREFIXES.some(
    (p) =>
      pathname === p ||
      (MEMBER_DASHBOARD_SUBPATH_PREFIXES.includes(p) &&
        pathname.startsWith(`${p}/`))
  );
}

function isPublicApi(pathname) {
  if (isPublicLlmApi(pathname)) return true;
  return PUBLIC_API_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// Shared with src/proxy.js — the mimo login branch must respect dashboard auth.
export { isAuthenticated };

export const __test__ = {
  isLocalRequest,
  isPublicLlmApi,
  extractApiKey,
  canAccessPublicLlmApi,
  canAccessLocalOnlyRoute,
  isMemberAllowedApiPath,
  isMemberAllowedDashboardPath,
};

export async function proxy(request) {
  const { pathname } = request.nextUrl;
  const method = request.method || "GET";

  // Member sessions: narrow allow-list, applied BEFORE every other gate.
  // (CLI-token requests carry no JWT, so they are unaffected here.)
  const memberToken = request.cookies.get("auth_token")?.value;
  const memberSession = memberToken ? await getDashboardAuthSession(memberToken) : null;
  if (getSessionRole(memberSession) === "member") {
    if (pathname.startsWith("/api/")) {
      if (isMemberAllowedApiPath(pathname, method)) return NextResponse.next();
      return NextResponse.json(
        { error: "Forbidden: member access restricted" },
        { status: 403 }
      );
    }
    if (pathname.startsWith("/dashboard")) {
      if (isMemberAllowedDashboardPath(pathname)) return NextResponse.next();
      return NextResponse.redirect(new URL("/dashboard/member", request.url));
    }
    if (pathname === "/") {
      return NextResponse.redirect(new URL("/dashboard/member", request.url));
    }
    // Public LLM API (/v1/*) etc. fall through to the normal gates below.
  }

  // Local-only gate for spawn-capable / host-secret routes.
  if (LOCAL_ONLY_PATHS.some((p) => pathname.startsWith(p))) {
    if (!(await canAccessLocalOnlyRoute(request))) {
      return NextResponse.json({ error: "Local only: CLI token required" }, { status: 403 });
    }
  }

  // Always protected - require valid JWT or local CLI token (machineId-based)
  if (ALWAYS_PROTECTED.some((p) => pathname.startsWith(p))) {
    if (await hasValidCliToken(request) || await hasValidToken(request))
      return NextResponse.next();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (isPublicLlmApi(pathname)) {
    if (await canAccessPublicLlmApi(request)) return NextResponse.next();
    return NextResponse.json({ error: "API key required for remote API access" }, { status: 401 });
  }

  // Deny-by-default for /api/* — public allow-list bypasses, everything else requires auth.
  if (pathname.startsWith("/api/")) {
    if (isPublicApi(pathname)) return NextResponse.next();
    if (await hasValidCliToken(request) || await isAuthenticated(request))
      return NextResponse.next();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Protect all dashboard routes
  if (pathname.startsWith("/dashboard")) {
    let requireLogin = true;
    let tunnelDashboardAccess = true;

    try {
      const settings = await loadSettings();
      if (settings) {
        requireLogin = settings.requireLogin !== false;
        tunnelDashboardAccess = settings.tunnelDashboardAccess === true;

        // Block tunnel/tailscale access if disabled (redirect to login)
        if (!tunnelDashboardAccess) {
          const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
          const tunnelHost = settings.tunnelUrl ? new URL(settings.tunnelUrl).hostname.toLowerCase() : "";
          const tailscaleHost = settings.tailscaleUrl ? new URL(settings.tailscaleUrl).hostname.toLowerCase() : "";
          if ((tunnelHost && host === tunnelHost) || (tailscaleHost && host === tailscaleHost)) {
            return NextResponse.redirect(new URL("/login", request.url));
          }
        }
      }
    } catch {
      // On error, keep defaults (require login, block tunnel)
    }

    // If login not required, allow through
    if (!requireLogin) return NextResponse.next();

    // Verify JWT token
    const token = request.cookies.get("auth_token")?.value;
    if (token) {
      if (await verifyDashboardAuthToken(token)) {
        return NextResponse.next();
      } else {
        return NextResponse.redirect(new URL("/login", request.url));
      }
    }

    return NextResponse.redirect(new URL("/login", request.url));
  }

  // h-router landing page: / is public. (The member branch above still
  // sends logged-in members to /dashboard/member; /dashboard itself is
  // still guarded by the block above.)
  if (pathname === "/") {
    return NextResponse.next();
  }

  return NextResponse.next();
}
