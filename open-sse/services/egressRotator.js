import {
  EGRESS_BAN_COOLDOWN_MS,
  EGRESS_ROTATE_MAX_ATTEMPTS,
  UPSTREAM_CODE_REQUEST_ILLEGAL,
  ABUSIVE_TRAFFIC_PATTERNS,
} from "../config/errorConfig.js";

export { EGRESS_BAN_COOLDOWN_MS, EGRESS_ROTATE_MAX_ATTEMPTS, UPSTREAM_CODE_REQUEST_ILLEGAL };

// Egress error taxonomy (plan #1, G1) — classifies an upstream failure so
// the caller blames the right thing:
//
//   403 + abusive-traffic wording  → 'rotate-relay'   (egress/IP is banned)
//   400 + code 11128 / "request illegal" → 'request-error' (request is at
//       fault; auto-patch headers already ran — rotate NOTHING)
//   429                          → 'backoff-account' (per-account quota;
//       existing accountFallback handles it — no relay ban)
//   anything else                → 'other'           (existing behavior)
//
// The distinction matters: rotating the relay on a 11128 would burn healthy
// relays, and locking the account on an abusive-traffic 403 would burn a
// healthy account. Only 'rotate-relay' may touch egress_relays state.

export const EGRESS_ACTIONS = {
  ROTATE_RELAY: "rotate-relay",
  BACKOFF_ACCOUNT: "backoff-account",
  REQUEST_ERROR: "request-error",
  OTHER: "other",
};

function textOf(errorText) {
  if (errorText == null) return "";
  return typeof errorText === "string" ? errorText : JSON.stringify(errorText);
}

// Extract a numeric upstream error code from the error text. Matches
// `"code":11128`, `code=11128`, `code 11128`, and bare `11128` in a JSON-ish
// body. Returns the first code found, or null.
export function extractUpstreamCode(errorText) {
  const text = textOf(errorText);
  const m = text.match(/"code"\s*:\s*(\d+)|code\s*[=:]\s*(\d+)|\b(\d{4,6})\b/);
  if (!m) return null;
  const code = Number(m[1] || m[2] || m[3]);
  return Number.isFinite(code) ? code : null;
}

export function isAbusiveTrafficError(errorText) {
  const lower = textOf(errorText).toLowerCase();
  if (!lower) return false;
  return ABUSIVE_TRAFFIC_PATTERNS.some((p) => lower.includes(p));
}

export function isRequestIllegalError(status, errorText) {
  if (Number(status) !== 400) return false;
  const text = textOf(errorText);
  if (extractUpstreamCode(text) === UPSTREAM_CODE_REQUEST_ILLEGAL) return true;
  return /request illegal/i.test(text);
}

export function classifyEgressError(status, errorText) {
  const code = extractUpstreamCode(errorText);
  const s = Number(status);

  if (isRequestIllegalError(s, errorText)) {
    return { action: EGRESS_ACTIONS.REQUEST_ERROR, code: UPSTREAM_CODE_REQUEST_ILLEGAL };
  }
  // Any 400 is a request problem (accountFallback agrees: requestScoped) —
  // never rotate the relay or lock the account over it.
  if (s === 400) {
    return { action: EGRESS_ACTIONS.REQUEST_ERROR, code };
  }
  if (s === 403 && isAbusiveTrafficError(errorText)) {
    return { action: EGRESS_ACTIONS.ROTATE_RELAY, code };
  }
  if (s === 429) {
    return { action: EGRESS_ACTIONS.BACKOFF_ACCOUNT, code };
  }
  return { action: EGRESS_ACTIONS.OTHER, code };
}

// Pure pool pick: first candidate (in the given order) not in `tried` and
// not banned. `candidates` is an ordered array of pool ids; `bannedIds` is
// a Set of pool ids on cooldown. Returns the pool id or null.
export function pickNextRelayPoolId(candidates, tried, bannedIds) {
  if (!Array.isArray(candidates)) return null;
  const triedSet = tried instanceof Set ? tried : new Set(tried || []);
  const bannedSet = bannedIds instanceof Set ? bannedIds : new Set(bannedIds || []);
  for (const id of candidates) {
    if (!id || triedSet.has(id) || bannedSet.has(id)) continue;
    return id;
  }
  return null;
}
