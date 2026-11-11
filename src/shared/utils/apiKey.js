import crypto from "crypto";

const API_KEY_SECRET = process.env.API_KEY_SECRET || "endpoint-proxy-api-key-secret";

/**
 * Generate 6-char random keyId
 */
function generateKeyId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate CRC (8-char HMAC)
 */
function generateCrc(machineId, keyId) {
  return crypto
    .createHmac("sha256", API_KEY_SECRET)
    .update(machineId + keyId)
    .digest("hex")
    .slice(0, 8);
}

/**
 * Generate API key with machineId embedded
 * Format: h-router-{machineId}-{keyId}-{crc8}
 * (Brand prefix "h-router" since 2026-11-10. Legacy "sk-" keys are still
 * accepted TRANSITIONALLY during the migration to h-router- keys — that
 * acceptance is not a permanent guarantee and may be removed later.)
 * @param {string} machineId - 16-char machine ID
 * @returns {{ key: string, keyId: string }}
 */
export function generateApiKeyWithMachine(machineId) {
  const keyId = generateKeyId();
  const crc = generateCrc(machineId, keyId);
  const key = `h-router-${machineId}-${keyId}-${crc}`;
  return { key, keyId };
}

/**
 * Parse API key and extract machineId + keyId
 * Supports all issued formats:
 * - Current: h-router-{machineId}-{keyId}-{crc8}
 * - Legacy new: sk-{machineId}-{keyId}-{crc8}
 * - Legacy old: sk-{random8}
 * @param {string} apiKey
 * @returns {{ machineId: string, keyId: string, isNewFormat: boolean } | null}
 */
export function parseApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== "string") return null;

  let rest = null;
  if (apiKey.startsWith("h-router-")) rest = apiKey.slice("h-router-".length);
  else if (apiKey.startsWith("sk-")) rest = apiKey.slice("sk-".length);
  else return null;

  const parts = rest.split("-");

  // Current / legacy-new format: {machineId}-{keyId}-{crc8} = 3 parts
  if (parts.length === 3) {
    const [machineId, keyId, crc] = parts;
    if (!machineId || !keyId || !crc) return null;

    // Validate CRC
    const expectedCrc = generateCrc(machineId, keyId);
    if (crc !== expectedCrc) return null;

    return { machineId, keyId, isNewFormat: true };
  }

  // Legacy old format: sk-{random8} = 1 part after the sk- prefix
  if (parts.length === 1 && apiKey.startsWith("sk-")) {
    return { machineId: null, keyId: parts[0], isNewFormat: false };
  }

  return null;
}

/**
 * Verify API key CRC (only for new format)
 * @param {string} apiKey
 * @returns {boolean}
 */
export function verifyApiKeyCrc(apiKey) {
  const parsed = parseApiKey(apiKey);
  if (!parsed) return false;
  
  // Old format doesn't have CRC, always valid if parsed
  if (!parsed.isNewFormat) return true;
  
  // New format already verified in parseApiKey
  return true;
}

/**
 * Check if API key is new format (contains machineId)
 * @param {string} apiKey
 * @returns {boolean}
 */
export function isNewFormatKey(apiKey) {
  const parsed = parseApiKey(apiKey);
  return parsed?.isNewFormat === true;
}

/**
 * Mask an API key for display (first 8 + *** + last 4).
 * Same rule as the usage-history masking in usageRepo.js.
 */
export function maskApiKey(key) {
  if (!key || typeof key !== "string") return null;
  const trimmed = key.trim();
  if (trimmed.length <= 12) return trimmed.charAt(0) + "***";
  return trimmed.slice(0, 8) + "***" + trimmed.slice(-4);
}

/**
 * The client key, read from the same places and in the same order as the
 * middleware (src/dashboardGuard.js) reads the key it authorizes a remote
 * /v1 call with: Bearer, x-api-key, x-goog-api-key, ?key=. Handlers' own
 * extractApiKey() only reads the first two, so using it here would let a
 * key sent as x-goog-api-key look like "no key".
 * Lives here (not in keyAccess.js) so the RPM limiter can use it without
 * importing the whole key-access module (which tests mock).
 */
export function extractClientApiKey(request) {
  const headers = request?.headers;
  if (!headers?.get) return null;
  const auth = headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  const xApiKey = headers.get("x-api-key");
  if (xApiKey) return xApiKey;
  const googKey = headers.get("x-goog-api-key");
  if (googKey) return googKey;
  try {
    return new URL(request.url).searchParams.get("key") || null;
  } catch {
    return null;
  }
}

