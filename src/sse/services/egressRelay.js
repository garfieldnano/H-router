import {
  getProviderConnections,
  getProxyPools,
  getBannedRelayPoolIds,
  markRelayBanned as dbMarkRelayBanned,
  recordRelaySuccess as dbRecordRelaySuccess,
} from "@/lib/localDb";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy.js";
import { resolveProviderId, FREE_PROVIDERS } from "@/shared/constants/providers.js";
import { EGRESS_BAN_COOLDOWN_MS } from "open-sse/config/errorConfig.js";
import { pickNextRelayPoolId } from "open-sse/services/egressRotator.js";

// Egress relay service (plan #1) — DB-backed side of the rotator. The pure
// taxonomy lives in open-sse/services/egressRotator.js; this module answers
// "which pool is next for this provider?" and applies ban/success state.
//
// ROTATION UNIT (G1, decided): one pool = one proxyUrl (one egress). The
// candidate set for a provider is the distinct proxyPoolIds bound to that
// provider's ACTIVE connections (first-seen order = connection priority
// order); noAuth free providers have no connections, so their candidate set
// is every active pool with a URL. Rotation keeps the SAME account and
// swaps only the egress — the account is healthy, the IP is banned.

// Per-provider auto-rotate switch (settings.providerStrategies[providerId].
// autoRotate). Default ON — the rotator is the point of feature #1; an
// admin disables it per provider from the proxy-pools page.
export function isEgressAutoRotateEnabled(settings, provider) {
  const providerId = resolveProviderId(provider);
  const override = settings?.providerStrategies?.[providerId];
  if (override && Object.prototype.hasOwnProperty.call(override, "autoRotate")) {
    return override.autoRotate !== false;
  }
  return true;
}

// Distinct pool ids bound to the provider's active connections, in
// first-seen (connection priority) order. noAuth providers: all active
// pools with a URL.
export async function getCandidateRelayPoolIds(provider) {
  const providerId = resolveProviderId(provider);
  const pools = await getProxyPools({ isActive: true });
  const usable = new Map();
  for (const p of pools) {
    if (p?.id && p.proxyUrl) usable.set(p.id, p);
  }
  if (FREE_PROVIDERS[providerId]?.noAuth) {
    return [...usable.keys()];
  }
  const connections = await getProviderConnections({ provider: providerId, isActive: true });
  const ids = [];
  for (const c of connections) {
    const poolId = c?.providerSpecificData?.proxyPoolId;
    if (poolId && usable.has(poolId) && !ids.includes(poolId)) ids.push(poolId);
  }
  return ids;
}

// Next relay for the provider: first candidate not tried and not banned.
// Returns the full pool object (or null when no relay is available — the
// caller then falls back to the existing account-rotation path).
export async function pickNextRelayPool({ provider, excludePoolIds = [] } = {}) {
  const candidates = await getCandidateRelayPoolIds(provider);
  const banned = new Set(await getBannedRelayPoolIds(candidates));
  const nextId = pickNextRelayPoolId(candidates, excludePoolIds, banned);
  if (!nextId) return null;
  const pools = await getProxyPools({ isActive: true });
  return pools.find((p) => p.id === nextId) || null;
}

// Mark the pool banned (cooldown EGRESS_BAN_COOLDOWN_MS) after an abusive-
// traffic 403. No-op for a null/empty pool id (legacy/direct egress has
// nothing to rotate to).
export async function markRelayBanned(poolId, { status, code } = {}) {
  if (!poolId) return null;
  return dbMarkRelayBanned(poolId, { status, code, cooldownMs: EGRESS_BAN_COOLDOWN_MS });
}

// Record a success through the pool (resets the fail streak). Best-effort:
// never throws — relay bookkeeping must not break a request.
export async function recordRelaySuccess(poolId) {
  if (!poolId) return null;
  try {
    return await dbRecordRelaySuccess(poolId);
  } catch {
    return null;
  }
}

// Resolve a pool id into the providerSpecificData patch the request path
// uses (same shape auth.js builds). Lets the chat loop swap the egress
// mid-request without re-selecting the account.
export async function resolveRelayProxyConfig(poolId) {
  const resolved = await resolveConnectionProxyConfig({ proxyPoolId: poolId || "" });
  return {
    connectionProxyEnabled: resolved.connectionProxyEnabled === true,
    connectionProxyUrl: resolved.connectionProxyUrl || "",
    connectionNoProxy: resolved.connectionNoProxy || "",
    connectionProxyPoolId: resolved.proxyPoolId || null,
    vercelRelayUrl: resolved.vercelRelayUrl || "",
    strictProxy: resolved.strictProxy === true,
  };
}
