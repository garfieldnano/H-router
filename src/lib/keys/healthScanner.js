// Parallel health scanner (plan #5).
//
// Scans every ACTIVE provider connection and classifies it as healthy /
// limit / dead / unknown, storing healthStatus + healthCheckedAt (+ error
// and latency) on the connection record (inside providerConnections.data,
// next to testStatus/lastError — no schema change needed for the
// connection record itself).
//
// G8 — PROBE INVENTORY (no new probes invented):
// The scanner reuses testSingleConnection() from
// src/app/api/providers/[id]/test/testUtils.js — the existing per-connection
// test the Providers page already uses. Its probe table (summarized; the
// full table is that file's OAUTH_TEST_CONFIG + testApiKeyConnection):
//   * OAuth family: per-provider userinfo/profile endpoints (GitHub,
//     GitLab, Qoder, KiloCode, Cline, Kimchi, Grok CLI /v1/user,
//     Muse /v1/models), Cloud Code Assist loadCodeAssist probe
//     (gemini-cli, antigravity), Codex backend-api responses probe
//     (400 = auth OK), expiry-only checks (kiro, kimi), token-exists
//     checks (cursor, codebuddy), Nous minimal chat probe.
//   * API-key family: GET {baseUrl}/models for OpenAI-compatible
//     providers (openai, deepseek, groq, mistral, xai, nvidia, perplexity,
//     together, fireworks, cerebras, cohere, nebius, siliconflow,
//     hyperbolic, chutes, xiaomi, blackbox, llm7, sensenova, ...),
//     POST /v1/messages (max_tokens 1) for Anthropic-compatible
//     (anthropic, glm, minimax, kimi), minimal chat completions for
//     azure / cloudflare-ai / alicode / volcengine / opencode-go,
//     provider-specific endpoints (openrouter /api/v1/auth/key,
//     gemini /v1/models?key=, deepgram /v1/projects, assemblyai
//     /v1/account, fal-ai /v1/models, qoder PAT exchange,
//     ollama /api/tags), probeBedrockCredentials (AWS), fetchWebIdentity
//     (web-cookie providers), Vertex generateContent probe.
//   * A "soft success" (e.g. Grok CLI 402 spending-limit) counts as
//     healthy: the credential works, the account is out of credits.
// The scanner adds only classification + parallelism + persistence on top.
//
// CLASSIFICATION (no-halu: never claim "dead" without evidence):
//   healthy — the probe says the credential works.
//   limit   — the probe says rate-limited / quota exhausted (429 etc).
//   dead    — the probe says the credential is rejected (invalid, revoked,
//             expired, access denied, no token). Only these may be
//             bulk-deleted.
//   unknown — everything else: probe unsupported for the provider, missing
//             config, network errors, 5xx, timeouts. Inconclusive is not
//             dead, and unknown connections are never bulk-deleted.
//
// This scanner covers PROVIDER credential health. Gateway uptime is the
// 0d detector's job (bot healthProbe.mjs, /api/health every 60s) — the
// scanner deliberately does not duplicate that probe.
import { getProviderConnections, updateProviderConnection, deleteProviderConnection, getProviderConnectionById } from "@/lib/db/repos/connectionsRepo.js";

export const HEALTH_STATUSES = ["healthy", "limit", "dead", "unknown"];
export const SCAN_CONCURRENCY = 10;
export const SCAN_PER_PROVIDER_CONCURRENCY = 3;

// Module-level run state (single process). Results are also persisted per
// connection, so the durable record survives a restart; this state is only
// the live progress + last-run summary.
let scanState = {
  running: false,
  startedAt: null,
  finishedAt: null,
  total: 0,
  done: 0,
  summary: null,
  results: [],
};

/** Classify one probe result. Exported for unit tests. */
export function classifyScanResult(result) {
  if (result?.valid) return "healthy";
  const err = String(result?.error || "");
  if (/429|rate.?limit|quota|too many requests/i.test(err)) return "limit";
  if (/provider test not supported/i.test(err)) return "unknown";
  if (/invalid|revoked|access denied|expired|unauthorized|no access token/i.test(err)) return "dead";
  // Network errors, 5xx, timeouts, missing config: inconclusive, not dead.
  return "unknown";
}

async function defaultTester(connectionId) {
  const { testSingleConnection } = await import("@/app/api/providers/[id]/test/testUtils.js");
  return testSingleConnection(connectionId);
}

/**
 * Scan all active provider connections in parallel.
 * @param {{ tester?: (id: string) => Promise<{valid:boolean,error?:string,latencyMs?:number}>, concurrency?: number, perProviderConcurrency?: number }} [opts]
 * @returns {Promise<{ running, startedAt, finishedAt, total, done, summary, results }>}
 * @throws {{ code: "SCAN_RUNNING" }} when a scan is already in progress.
 */
export async function runHealthScan({
  tester = defaultTester,
  concurrency = SCAN_CONCURRENCY,
  perProviderConcurrency = SCAN_PER_PROVIDER_CONCURRENCY,
} = {}) {
  if (scanState.running) {
    const err = new Error("A health scan is already running");
    err.code = "SCAN_RUNNING";
    throw err;
  }
  // Claim the run synchronously, BEFORE the first await: two calls in the
  // same tick must not both pass the guard (the await below would let the
  // second call in before the flag is set).
  const startedAt = new Date().toISOString();
  scanState = {
    running: true,
    startedAt,
    finishedAt: null,
    total: 0,
    done: 0,
    summary: null,
    results: [],
  };
  const connections = await getProviderConnections({ isActive: true });
  scanState.total = connections.length;

  const scanOne = async (conn) => {
    const started = Date.now();
    let result;
    try {
      result = await tester(conn.id);
    } catch (err) {
      result = { valid: false, error: err?.message || String(err), latencyMs: Date.now() - started };
    }
    const status = classifyScanResult(result);
    const latencyMs = Number.isFinite(result?.latencyMs) ? result.latencyMs : Date.now() - started;
    await updateProviderConnection(conn.id, {
      healthStatus: status,
      healthCheckedAt: new Date().toISOString(),
      healthError: status === "healthy" ? null : (result?.error || null),
      healthLatencyMs: latencyMs,
    }).catch(() => null);
    const entry = {
      connectionId: conn.id,
      provider: conn.provider,
      name: conn.name || conn.email || conn.id,
      status,
      error: result?.error || null,
      latencyMs,
    };
    scanState.results.push(entry);
    return entry;
  };

  // Bounded pool: at most `concurrency` probes in flight, at most
  // `perProviderConcurrency` per provider (so one provider with 100 keys
  // cannot hammer its own API with 10 parallel probes).
  const queue = [...connections];
  const runningByProvider = new Map();
  let inFlight = 0;
  await new Promise((resolve) => {
    const pump = () => {
      while (inFlight < concurrency) {
        const idx = queue.findIndex(
          (c) => (runningByProvider.get(c.provider) || 0) < perProviderConcurrency
        );
        if (idx === -1) {
          if (inFlight === 0) resolve();
          return;
        }
        const conn = queue.splice(idx, 1)[0];
        inFlight++;
        runningByProvider.set(conn.provider, (runningByProvider.get(conn.provider) || 0) + 1);
        scanOne(conn).finally(() => {
          inFlight--;
          runningByProvider.set(conn.provider, (runningByProvider.get(conn.provider) || 0) - 1);
          scanState.done++;
          pump();
        });
      }
      if (queue.length === 0 && inFlight === 0) resolve();
    };
    pump();
  });

  const finishedAt = new Date().toISOString();
  const summary = {
    total: scanState.total,
    healthy: 0,
    limit: 0,
    dead: 0,
    unknown: 0,
    startedAt,
    finishedAt,
    durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
  };
  for (const r of scanState.results) summary[r.status]++;
  scanState = { ...scanState, running: false, finishedAt, summary };
  return scanState;
}

/** Live progress + last-run summary/results (in-memory). */
export function getScanState() {
  return scanState;
}

/** Test helper — resets the run state. */
export function resetScanState() {
  scanState = {
    running: false,
    startedAt: null,
    finishedAt: null,
    total: 0,
    done: 0,
    summary: null,
    results: [],
  };
}

/**
 * Bulk-delete connections, but ONLY ones whose stored health status is
 * "dead" — the server re-checks the stored status, so a client cannot
 * delete a healthy/limit/unknown connection by naming its id.
 * @returns {Promise<{ deleted: string[], skipped: string[] }>}
 */
export async function deleteDeadConnections(connectionIds) {
  const deleted = [];
  const skipped = [];
  for (const id of Array.isArray(connectionIds) ? connectionIds : []) {
    const conn = await getProviderConnectionById(id).catch(() => null);
    if (!conn || conn.healthStatus !== "dead") {
      skipped.push(id);
      continue;
    }
    const ok = await deleteProviderConnection(id).catch(() => false);
    if (ok) deleted.push(id);
    else skipped.push(id);
  }
  return { deleted, skipped };
}
