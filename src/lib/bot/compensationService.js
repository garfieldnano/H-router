// Server-side compensation service — incident recording + manual grants.
// Called ONLY by the internal /api/bot/* routes and the web /api/incidents
// routes. The bot process itself never touches the DB; it only calls those
// routes (the health prober reports up/down; the server decides).

import {
  getIncidentById, getOpenIncident, createIncident, closeIncident,
  updateIncidentLastSeen, getCompensationByIncidentAndKey,
  insertCompensationAndExtendKey, getRecentErrorRate,
  getApiKeyById, getChatByMemberId,
} from "@/lib/localDb.js";
import {
  tierForOutageMinutes, isValidTierHours, extendExpiry,
  evaluateErrorRate, incidentDurationMinutes,
  ERROR_RATE_WINDOW_MINUTES,
} from "./compensation.js";

// ---------------------------------------------------------- probe recording
// recordProbe is the detector's write side. The bot prober calls it every
// minute with the /api/health result; the server opens/extends/closes the
// incident row. A reachable gateway whose recent requests mostly error is
// still down (error-rate signal), so an 'up' report first checks the error
// rate before closing an open incident.
//
// Returns { ok, action: 'opened'|'extended'|'closed'|'none', incident }.
export async function recordProbe({ status, reason, reasonDetail, firstFailedAt, checkedAt } = {}) {
  const now = checkedAt ? new Date(checkedAt) : new Date();
  if (Number.isNaN(now.getTime())) return { ok: false, error: "checkedAt tidak valid", status: 400 };

  if (status === "down") {
    return recordDown({ reason, reasonDetail, firstFailedAt, now });
  }
  if (status !== "up") {
    return { ok: false, error: "status harus 'up' atau 'down'", status: 400 };
  }

  // Gateway reachable — but check the error rate before declaring recovery.
  const rate = await getRecentErrorRate(ERROR_RATE_WINDOW_MINUTES);
  const evald = evaluateErrorRate(rate);
  if (evald.isDown) {
    return recordDown({
      reason: "error-rate",
      reasonDetail: `${evald.errors}/${evald.total} request error dalam ${ERROR_RATE_WINDOW_MINUTES} menit terakhir`,
      firstFailedAt: new Date(now.getTime() - ERROR_RATE_WINDOW_MINUTES * 60000).toISOString(),
      now,
    });
  }

  const open = await getOpenIncident("gateway");
  if (!open) return { ok: true, action: "none", incident: null };
  const closed = await closeIncident(open.id, now.toISOString());
  return { ok: true, action: "closed", incident: closed };
}

async function recordDown({ reason, reasonDetail, firstFailedAt, now }) {
  const open = await getOpenIncident("gateway");
  if (open) {
    await updateIncidentLastSeen(open.id, now.toISOString());
    return { ok: true, action: "extended", incident: { ...open, lastSeenAt: now.toISOString() } };
  }
  const startedAt = firstFailedAt
    ? new Date(firstFailedAt).toISOString()
    : now.toISOString();
  const incident = await createIncident({
    scope: "gateway",
    reason: reason || "unreachable",
    reasonDetail: reasonDetail || null,
    startedAt,
  });
  return { ok: true, action: "opened", incident };
}

// ---------------------------------------------------------- manual grant
// Grant a time extension to one key for one incident. NEVER automatic —
// only an admin calling this (web panel or bot admin panel) grants.
// tierHours omitted → derived from the incident's duration (closed: final
// duration; open: duration so far).
//
// Refusals (no silent no-ops): unknown incident/key, inactive key, key
// without expiresAt (nothing to extend), invalid tier, or a compensation
// already granted for this (incident, key) pair.
export async function grantCompensation({ incidentId, keyId, tierHours, grantedBy = "admin" } = {}) {
  const incident = await getIncidentById(incidentId);
  if (!incident) return { ok: false, error: "Insiden tidak ditemukan", status: 404 };
  const key = await getApiKeyById(keyId);
  if (!key) return { ok: false, error: "Kunci tidak ditemukan", status: 404 };
  if (!key.isActive) {
    return { ok: false, error: "Kunci sudah nonaktif — aktifkan dulu sebelum memberi kompensasi", status: 409 };
  }
  if (!key.expiresAt) {
    return { ok: false, error: "Kunci tidak punya masa berlaku (tanpa expiresAt) — perpanjangan tidak bisa diterapkan", status: 409 };
  }

  const duration = incidentDurationMinutes(incident);
  const derivedTier = tierForOutageMinutes(duration);
  const hours = tierHours === undefined || tierHours === null ? derivedTier : Number(tierHours);
  if (!isValidTierHours(hours)) {
    return { ok: false, error: "Tier harus 1, 3, 5, atau 8 jam", status: 400 };
  }

  const existing = await getCompensationByIncidentAndKey(incidentId, keyId);
  if (existing) {
    return { ok: false, error: "Kompensasi untuk insiden ini sudah pernah diberikan ke kunci ini", status: 409 };
  }

  const newExpiresAt = extendExpiry(key.expiresAt, hours);
  let compensation;
  try {
    compensation = await insertCompensationAndExtendKey({
      memberId: key.memberId || null,
      keyId,
      incidentId,
      amount: hours,
      grantedBy,
      oldExpiresAt: key.expiresAt,
      newExpiresAt,
    });
  } catch (e) {
    // Race backstop: the UNIQUE index on (incidentId, keyId) fired.
    if (e?.code === "DUPLICATE_COMPENSATION" || /UNIQUE constraint failed/i.test(e?.message || "")) {
      return { ok: false, error: "Kompensasi untuk insiden ini sudah pernah diberikan ke kunci ini", status: 409 };
    }
    throw e;
  }

  // Telegram chat of the member (if linked) so the caller can notify them.
  let notifyChatId = null;
  if (key.memberId) {
    const chat = await getChatByMemberId(key.memberId).catch(() => null);
    notifyChatId = chat?.chatId || null;
  }

  return {
    ok: true,
    compensation,
    key: { ...key, expiresAt: newExpiresAt },
    incident,
    derivedTier,
    durationMinutes: duration,
    notifyChatId,
  };
}
