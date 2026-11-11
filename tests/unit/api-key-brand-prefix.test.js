import { describe, it, expect } from "vitest";
import {
  generateApiKeyWithMachine,
  parseApiKey,
  verifyApiKeyCrc,
  isNewFormatKey,
} from "../../src/shared/utils/apiKey.js";

const MACHINE_ID = "0123456789abcdef";

describe("API key brand prefix (h-router-)", () => {
  it("generates new keys with the h-router- prefix", () => {
    const { key, keyId } = generateApiKeyWithMachine(MACHINE_ID);

    expect(key.startsWith("h-router-")).toBe(true);
    expect(key).toBe(`h-router-${MACHINE_ID}-${keyId}-${key.split("-").at(-1)}`);
    expect(keyId).toMatch(/^[a-z0-9]{6}$/);
  });

  it("parses and verifies a generated h-router- key", () => {
    const { key, keyId } = generateApiKeyWithMachine(MACHINE_ID);

    const parsed = parseApiKey(key);
    expect(parsed).toEqual({ machineId: MACHINE_ID, keyId, isNewFormat: true });
    expect(verifyApiKeyCrc(key)).toBe(true);
    expect(isNewFormatKey(key)).toBe(true);
  });

  it("still parses and verifies legacy sk- new-format keys", () => {
    // Same structure as generateApiKeyWithMachine, old prefix.
    const { key } = generateApiKeyWithMachine(MACHINE_ID);
    const legacyKey = key.replace("h-router-", "sk-");

    const parsed = parseApiKey(legacyKey);
    expect(parsed?.isNewFormat).toBe(true);
    expect(parsed?.machineId).toBe(MACHINE_ID);
    expect(verifyApiKeyCrc(legacyKey)).toBe(true);
    expect(isNewFormatKey(legacyKey)).toBe(true);
  });

  it("still parses legacy sk- old-format keys (sk-{random8})", () => {
    const parsed = parseApiKey("sk-ab12cd34");
    expect(parsed).toEqual({ machineId: null, keyId: "ab12cd34", isNewFormat: false });
    expect(verifyApiKeyCrc("sk-ab12cd34")).toBe(true);
    expect(isNewFormatKey("sk-ab12cd34")).toBe(false);
  });

  it("rejects a tampered CRC on h-router- keys", () => {
    const { key } = generateApiKeyWithMachine(MACHINE_ID);
    const tampered = key.slice(0, -1) + (key.endsWith("0") ? "1" : "0");

    expect(parseApiKey(tampered)).toBeNull();
    expect(verifyApiKeyCrc(tampered)).toBe(false);
    expect(isNewFormatKey(tampered)).toBe(false);
  });

  it("rejects a tampered CRC on legacy sk- keys", () => {
    const { key } = generateApiKeyWithMachine(MACHINE_ID);
    const legacyKey = key.replace("h-router-", "sk-");
    const tampered = legacyKey.slice(0, -1) + (legacyKey.endsWith("0") ? "1" : "0");

    expect(parseApiKey(tampered)).toBeNull();
    expect(verifyApiKeyCrc(tampered)).toBe(false);
  });

  it("rejects unknown prefixes and malformed keys", () => {
    expect(parseApiKey("ak-0123456789abcdef-abc123-deadbeef")).toBeNull();
    expect(parseApiKey("h-router-abc123")).toBeNull();
    expect(parseApiKey("h-router-")).toBeNull();
    expect(parseApiKey("")).toBeNull();
    expect(parseApiKey(null)).toBeNull();
    expect(verifyApiKeyCrc("not-a-key")).toBe(false);
  });
});
