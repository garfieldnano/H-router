// Minimal gateway-uptime detector — runs inside the bot process (a separate
// failure domain from the Next.js server, so it can still record an outage
// when the gateway itself is down). Every PROBE_INTERVAL_MS it probes
// <webUrl>/api/health; after PROBE_FAILURES_TO_OPEN consecutive failures it
// reports 'down' to the server (which opens/extends the incident row), and
// on recovery it reports 'up' (which closes it). The server also checks the
// recent request error rate on every 'up' report — a reachable gateway that
// mostly errors stays down.
//
// SEAM for scanner #5: when the full health scanner lands, it can reuse the
// same /api/bot/admin/incidents/probe endpoint (with scope 'provider') and
// this prober's open/close callbacks — the incident tables and grant flow
// already support any scope.
//
// The prober is injectable (probeFn / api) so unit tests can drive the
// streak state machine without a network or a server.

import {
  PROBE_INTERVAL_MS,
  PROBE_FAILURES_TO_OPEN,
  PROBE_TIMEOUT_MS,
} from "../lib/bot/compensation.mjs";

export function createHealthProber({
  baseUrl,
  api,
  onIncidentOpened,
  onIncidentClosed,
  intervalMs = PROBE_INTERVAL_MS,
  failuresToOpen = PROBE_FAILURES_TO_OPEN,
  probeFn,
  log = console.log,
} = {}) {
  let timer = null;
  let consecutiveFailures = 0;
  let firstFailedAt = null;
  let openIncidentId = null;
  // True once a 'down' report was attempted — a sub-threshold streak that
  // recovers must report nothing (no incident was ever opened).
  let downReported = false;

  async function defaultProbe() {
    try {
      const res = await fetch(`${baseUrl}/api/health`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (!res.ok) return { ok: false, reason: `http-${res.status}` };
      const data = await res.json().catch(() => ({}));
      if (data && data.ok === false) return { ok: false, reason: "health-not-ok" };
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e?.name === "TimeoutError" ? "timeout" : "unreachable" };
    }
  }

  async function reportDown(reason) {
    downReported = true;
    try {
      const res = await api.recordProbe({
        status: "down",
        reason,
        firstFailedAt: firstFailedAt ? firstFailedAt.toISOString() : undefined,
      });
      if (res?.action === "opened" && res.incident) {
        openIncidentId = res.incident.id;
        try { await onIncidentOpened?.(res.incident); } catch {}
      } else if (res?.incident?.status === "open") {
        openIncidentId = res.incident.id;
      }
    } catch (e) {
      log(`[bot][probe] gagal melaporkan gangguan: ${e.message}`);
    }
  }

  async function reportUp() {
    try {
      const res = await api.recordProbe({ status: "up" });
      if (res?.incident?.status === "closed") {
        const closed = res.incident;
        openIncidentId = null;
        try { await onIncidentClosed?.(closed); } catch {}
      } else if (res?.incident?.status === "open") {
        // The server's error-rate check kept the incident open.
        openIncidentId = res.incident.id;
      }
    } catch (e) {
      log(`[bot][probe] gagal melaporkan pulih: ${e.message}`);
    }
  }

  async function tick() {
    const probe = probeFn || defaultProbe;
    let result;
    try {
      result = await probe();
    } catch (e) {
      result = { ok: false, reason: "probe-error" };
    }
    const now = new Date();
    if (result?.ok) {
      const wasFailing = downReported || openIncidentId;
      consecutiveFailures = 0;
      firstFailedAt = null;
      if (!wasFailing) return;
      await reportUp();
      downReported = false;
      return;
    }
    consecutiveFailures += 1;
    if (!firstFailedAt) firstFailedAt = now;
    if (consecutiveFailures < failuresToOpen) return;
    await reportDown(result?.reason || "unreachable");
  }

  return {
    tick,
    get state() {
      return { consecutiveFailures, openIncidentId, downReported };
    },
    start() {
      if (timer) return this;
      timer = setInterval(() => {
        tick().catch((e) => log(`[bot][probe] ${e.message}`));
      }, intervalMs);
      timer.unref?.();
      return this;
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
