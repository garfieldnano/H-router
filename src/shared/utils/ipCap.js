// Active IP cap — shared constants + validation (plan #5).
//
// A key may be used from at most `maxIps` distinct client IPs inside the
// 10-minute sliding window. The cap is per KEY (not per member): a member
// with several keys gets the cap on each key separately. The count is
// distinct IPs, not requests — one IP hammering the key counts once.
//
// Default (user decision 2026-11-11 ~02:34 WIB): 3 IPs. The plan's
// "default 11/22" was unclear, so the user picked 3. Per-key override via
// apiKeys.maxIps (NULL = default). There is NO unlimited value: a key with
// no override gets the default 3.
export const IP_CAP_WINDOW_MS = 10 * 60 * 1000;
export const DEFAULT_MAX_IPS = 3;
export const IP_CAP_MIN = 1;
export const IP_CAP_MAX = 100;

/**
 * Validate a max-IPs value from admin input.
 * null/undefined/"" → { ok: true, value: null } (use the default).
 * A number or numeric string must be an integer in [IP_CAP_MIN, IP_CAP_MAX].
 * @returns {{ ok: boolean, value: number|null, error?: string }}
 */
export function parseMaxIps(value) {
  if (value === null || value === undefined || value === "") {
    return { ok: true, value: null };
  }
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { ok: false, value: null, error: "Batas IP harus bilangan bulat" };
  }
  if (n < IP_CAP_MIN || n > IP_CAP_MAX) {
    return { ok: false, value: null, error: `Batas IP harus antara ${IP_CAP_MIN} dan ${IP_CAP_MAX}` };
  }
  return { ok: true, value: n };
}

/** Effective IP cap for a key record: per-key override, else the default 3. */
export function resolveMaxIps(keyRecord) {
  return keyRecord?.maxIps ?? DEFAULT_MAX_IPS;
}
