import { randomUUID } from "node:crypto";
import { buildKimiHeaders } from "../config/appConstants.js";
import { buildClineHeaders } from "../shared/clineAuth.js";

// Provider-specific header quirks (plan #1: registry-driven auto-patch).
// The IMPLEMENTATIONS live here (one module, imported by the executors);
// which hooks run for a provider is declared in the registry as
// `transport.headerHooks: [...]` — a new free-tier provider adds its hook
// name there, no executor change needed. `auth.hooks` is the legacy
// location and is still honored by buildHeaders.
export const HEADER_HOOKS = {
  // CodeBuddy (CN + intl): the gateway runs a channel check per request and
  // rejects anything that does not carry the conversation/request identifiers
  // the official plugin sends. Without them upstream answers
  // 400 {"code":11128,"msg":"request illegal"} with
  // "This call failed channel verification, possibly because it was not sent
  // from an official client" — the request never reaches the model.
  // The same request WITH these headers passes channel verification and gets
  // as far as the real rate limiter (429 / 6004).
  codebuddyHeaders: (h) => {
    const requestId = randomUUID();
    h["X-Request-ID"] = requestId;
    h["X-Conversation-ID"] = randomUUID();
    h["X-Conversation-Request-ID"] = requestId;
    h["X-Conversation-Message-ID"] = requestId;
  },
  // Stable device_id from OAuth connection (CLIProxyAPI KimiTokenStorage.DeviceID)
  kimiHeaders: (h, c) => Object.assign(h, buildKimiHeaders(c?.providerSpecificData?.deviceId)),
  // MiniMax Code (mcode): the placeholder x-api-key rides every request next
  // to the Bearer token, plus per-request session/timezone headers. Static
  // teammates (User-Agent, X-Mavis-Agent-Id) live in the registry transport.
  minimaxHeaders: (h) => {
    h["x-api-key"] = "sk-xxx";
    h["X-Mavis-Timezone-Offset"] = String(new Date().getTimezoneOffset() * -60);
    if (!h["X-Mavis-Session-Id"]) h["X-Mavis-Session-Id"] = randomUUID();
  },
  // Muse: x-api-version only on subscription (minted key) requests — plain
  // Model API keys already work without it
  museHeaders: (h, c) => { if (c?.accessToken && !c?.apiKey) h["x-api-version"] = "1.0.0"; },
  clineHeaders: (h, c) => Object.assign(h, buildClineHeaders(c.apiKey || c.accessToken)),
  kilocodeOrg: (h, c) => { if (c.providerSpecificData?.orgId) h["X-Kilocode-OrganizationID"] = c.providerSpecificData.orgId; },
};

// Run the named hooks (in order, deduped by the caller) against headers.
// Unknown hook names are ignored — a registry typo must not break requests.
export function applyHeaderHooks(headers, hookNames, credentials) {
  for (const name of hookNames || []) {
    HEADER_HOOKS[name]?.(headers, credentials);
  }
  return headers;
}
