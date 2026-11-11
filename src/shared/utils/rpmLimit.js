// RPM (requests per minute) limits — shared constants + validation.
// Priority chain (implemented in src/sse/services/keyRateLimit.js):
//   per-key apiKeys.rpmLimit → per-package packages.rpmLimit
//   → trial default (20) when the key's package is a trial package
//   → global default (settings.defaultRpmLimit, 50).
// There is NO unlimited tier: a key with no limit anywhere gets the global
// default. NULL rpmLimit anywhere means "inherit from the next level".
export const RPM_MIN = 1;
export const RPM_MAX = 10000;
export const TRIAL_DEFAULT_RPM = 20;
export const GLOBAL_DEFAULT_RPM = 50;

/**
 * Validate an RPM value from admin input.
 * null/undefined/"" → { ok: true, value: null } (inherit from next level).
 * A number or numeric string must be an integer in [RPM_MIN, RPM_MAX].
 * @returns {{ ok: boolean, value: number|null, error?: string }}
 */
export function parseRpmLimit(value) {
  if (value === null || value === undefined || value === "") {
    return { ok: true, value: null };
  }
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { ok: false, value: null, error: "RPM harus bilangan bulat" };
  }
  if (n < RPM_MIN || n > RPM_MAX) {
    return { ok: false, value: null, error: `RPM harus antara ${RPM_MIN} dan ${RPM_MAX}` };
  }
  return { ok: true, value: n };
}

/** Human label for where a key's effective RPM comes from. */
export function rpmSourceLabel(source) {
  switch (source) {
    case "key": return "per kunci";
    case "package": return "per paket";
    case "trial-default": return "default trial";
    case "global": return "global";
    default: return source || "-";
  }
}
