import "open-sse/index.js";

import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { handleAntigravityQuotaError, clearAntigravityStrikes } from "../services/antigravityQuota.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo, getComboModels } from "../services/model.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { DEFAULT_HEADROOM_URL } from "@/lib/headroom/detect";
import { getTransform as getPxpipeTransform } from "@/lib/pxpipe/loader.js";
import { appendPxpipeEvent } from "@/lib/pxpipe/events.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { upstreamResponseHeaders } from "open-sse/utils/upstreamHeaders.js";
import { handleComboChat, handleFusionChat, detectRequiredCapabilities } from "open-sse/services/combo.js";
import { augmentModelsWithCapacityAdapter, withCapacityAdapterStripping, getActiveAdapterStrategy } from "open-sse/services/capacityAdapter.js";
import { handleBypassRequest } from "open-sse/utils/bypassHandler.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { detectFormatByEndpoint } from "open-sse/translator/formats.js";
import { resolveSessionIdentity } from "open-sse/utils/sessionManager.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { getProjectIdForConnection } from "open-sse/services/projectId.js";
import { stripModelContextMarker } from "open-sse/utils/modelMarkers.js";
import { resolveRtkEnabled } from "@/shared/utils/rtkModel.js";
import { resolveBrandModel, findLivePromptForRequest } from "@/lib/db/repos/modelBrandsRepo.js";
import { applyLivePromptToBody } from "@/shared/utils/brandModel.js";
import { detectFormat } from "open-sse/services/provider.js";
import { getKeyAccessContext, enforceKeyAccess, filterAdapterModels } from "../services/keyAccess.js";
import { enforceKeyRateLimit } from "../services/keyRateLimit.js";
import { enforceKeyIpCap } from "../services/keyIpCap.js";
import { resolveSmartChoice } from "../services/systemoneRouter.js";
import { classifyEgressError, EGRESS_ACTIONS, EGRESS_ROTATE_MAX_ATTEMPTS } from "open-sse/services/egressRotator.js";
import { pickNextRelayPool, markRelayBanned, recordRelaySuccess, isEgressAutoRotateEnabled } from "../services/egressRelay.js";
import { enforceVisionGate } from "../services/visionGate.js";

/**
 * Handle chat completion request
 * Supports: OpenAI, Claude, Gemini, OpenAI Responses API formats
 * Format detection and translation handled by translator
 */
export async function handleChat(request, clientRawRequest = null) {
  let body;
  try {
    body = await request.json();
  } catch {
    log.warn("CHAT", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  // Build clientRawRequest for logging (if not provided)
  if (!clientRawRequest) {
    const url = new URL(request.url);
    clientRawRequest = {
      endpoint: url.pathname,
      body,
      headers: Object.fromEntries(request.headers.entries())
    };
  }
  // Claude Code marks a 1M-context request as `<model>[1m]`; the marker matches
  // no combo, alias or provider/model pair, so it must not reach resolution.
  // The capability travels in the anthropic-beta header, forwarded as-is.
  const { model: requestedModelStr, contextMarker } = stripModelContextMarker(body.model);
  if (contextMarker) body.model = requestedModelStr;
  let modelStr = requestedModelStr;

  // Model rebranding (plan #2): a brand id (e.g. "h-router/ultra-pro")
  // resolves to its upstream provider/model BEFORE any access check,
  // combo expansion or credential lookup, so a restricted key's allow
  // list is evaluated on the upstream target. The brand id is remembered
  // for the live-prompt lookup in handleSingleModelChat.
  let brandModelId = null;
  try {
    const brand = await resolveBrandModel(modelStr);
    if (brand) {
      brandModelId = brand.brand.brandModelId;
      modelStr = `${brand.provider}/${brand.model}`;
      // NOTE: body.model is deliberately NOT rewritten — the raw-request
      // log keeps the brand the client actually asked for; the resolved
      // model travels via modelStr and is stamped into the handleChatCore
      // body downstream.
    }
  } catch (e) {
    log?.warn?.("BRAND", `brand resolution failed (fail-open): ${e?.message || e}`);
  }

  const session = resolveSessionIdentity({ headers: clientRawRequest?.headers, body });
  const sessionId = session?.sessionId || null;

  // Request summary is emitted as the unified "▶" line in chatCore (has fmt/thinking/account)

  // Log API key (masked)
  const authHeader = request.headers.get("Authorization");
  const apiKey = extractApiKey(request);
  if (authHeader && apiKey) {
    const masked = log.maskKey(apiKey);
    log.debug("AUTH", `API Key: ${masked}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  // Enforce API key if enabled in settings
  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) {
      log.warn("AUTH", "Missing API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    }
    const valid = await isValidApiKey(apiKey);
    if (!valid) {
      log.warn("AUTH", "Invalid API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
    }
  }

  if (!modelStr) {
    log.warn("CHAT", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  // Per-key access control: a restricted key may call only its listed combos and
  // models. Checked once on the requested target, before bypass, combo expansion
  // and any credential lookup; an allowed combo grants the members it routes to.
  const keyAccess = await getKeyAccessContext(request);
  const keyAccessDenied = await enforceKeyAccess(keyAccess, modelStr);
  if (keyAccessDenied) return keyAccessDenied;

  // Active IP cap (plan #5): over the cap → 429 + Retry-After. Runs
  // before the RPM check so a rejected request does not consume an RPM slot.
  const ipCapLimited = await enforceKeyIpCap(request);
  if (ipCapLimited) return ipCapLimited;

  // RPM limit (plan §0c): one client request counts once per key per minute,
  // before bypass/combo/credential lookup. Over the limit → 429 + Retry-After.
  const rateLimited = await enforceKeyRateLimit(request);
  if (rateLimited) return rateLimited;

  // Bypass naming/warmup requests before combo rotation to avoid wasting rotation slots
  const userAgent = request?.headers?.get("user-agent") || "";
  const bypassResponse = handleBypassRequest(body, modelStr, userAgent, !!settings.ccFilterNaming);
  if (bypassResponse) return bypassResponse.response || bypassResponse;

  const requiredCapabilities = detectRequiredCapabilities(body);

  // Check if model is a combo (has multiple models with fallback)
  const comboModels = await getComboModels(modelStr);

  // Vision Adapter (plan G10): an image request to a model that cannot read
  // images is rejected with a clear 400 naming the model + vision-capable
  // alternatives (or redirected by the capacity adapter when a vision pool
  // is configured) — never silently stripped. Runs after brand resolution
  // (modelStr is upstream) and after the key-access / IP-cap / RPM gates,
  // before combo expansion. Text-only requests pass through untouched.
  const visionDenied = await enforceVisionGate({
    modelStr,
    brandModelId,
    comboModels,
    settings,
    keyAccess,
    requiredCapabilities,
  });
  if (visionDenied) return visionDenied;

  if (comboModels) {
    // Check for combo-specific strategy first, fallback to global
    const comboStrategies = settings.comboStrategies || {};
    const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
    const comboStrategy = comboSpecificStrategy || settings.comboStrategy || "fallback";
    const augmentedModels = await filterAdapterModels(keyAccess, augmentModelsWithCapacityAdapter(comboModels, requiredCapabilities, settings), comboModels);
    const adapterAdded = augmentedModels.filter((m) => !comboModels.includes(m));

    if (comboStrategy === "fusion") {
      log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
      return handleFusionChat({
        body,
        models: comboModels,
        handleSingleModel: (b, m, isPanel) => {
          let cleanRawReq = clientRawRequest;
          if (isPanel && clientRawRequest) {
            const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
            cleanRawReq = { ...clientRawRequest, body: cleanBody };
          }
          return handleSingleModelChat(b, m, cleanRawReq, request, apiKey, null, brandModelId);
        },
        log,
        comboName: modelStr,
        judgeModel: comboStrategies[modelStr]?.judgeModel,
        tuning: comboStrategies[modelStr]?.fusionTuning,
      });
    }

    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    const comboCfg = comboStrategies[modelStr] || {};
    log.info("CHAT", `Combo "${modelStr}" with ${augmentedModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      body,
      models: augmentedModels,
      handleSingleModel: withCapacityAdapterStripping(
        (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey, null, brandModelId),
        adapterAdded
      ),
      log,
      comboName: modelStr,
      comboStrategy,
      comboStickyLimit,
      sessionId,
      smartPolicy: comboCfg.smartPolicy || "smart",
      sessionSticky: comboCfg.sessionSticky !== false,
      confidenceThreshold: typeof comboCfg.confidenceThreshold === "number" ? comboCfg.confidenceThreshold : 0.8,
      resolveSmartChoice: comboStrategy === "smart"
        ? (b, m) => resolveSmartChoice({
            body: b,
            models: m,
            routerModel: comboCfg.routerModel,
            log,
          })
        : null,
    });
  }

  // Single model request — may still switch to a capacity-adapter model if the
  // target lacks a capability the request needs (e.g. no vision, request has an image).
  const soloAugmented = await filterAdapterModels(keyAccess, augmentModelsWithCapacityAdapter([modelStr], requiredCapabilities, settings), [modelStr]);
  if (soloAugmented.length > 1) {
    const adapterAdded = soloAugmented.filter((m) => m !== modelStr);
    log.info("CHAT", `Capacity adapter for [${[...requiredCapabilities].join(",")}] on "${modelStr}" → trying ${soloAugmented.join(", ")}`);
    return handleComboChat({
      body,
      models: soloAugmented,
      handleSingleModel: withCapacityAdapterStripping(
        (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey, null, brandModelId),
        adapterAdded
      ),
      log,
      comboName: modelStr,
      comboStrategy: getActiveAdapterStrategy(requiredCapabilities, settings)
    });
  }

  return handleSingleModelChat(body, modelStr, clientRawRequest, request, apiKey, contextMarker ? `${modelStr.slice(modelStr.indexOf("/") + 1)}[${contextMarker}]` : null, brandModelId);
}

/**
 * Handle single model chat request
 */
async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null, apiKey = null, requestedModel = null, brandModelId = null) {
  const modelInfo = await getModelInfo(modelStr);

  // If provider is null, this might be a combo name - check and handle
  if (!modelInfo.provider) {
    const comboModels = await getComboModels(modelStr);
    if (comboModels) {
      const chatSettings = await getSettings();
      // Check for combo-specific strategy first, fallback to global
      const comboStrategies = chatSettings.comboStrategies || {};
      const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
      const comboStrategy = comboSpecificStrategy || chatSettings.comboStrategy || "fallback";
      const requiredCapabilities = detectRequiredCapabilities(body);
      // Nested combo (a combo member that is itself a combo): the access decision
      // was made on the outer target; only drop adapter models the key may not call.
      const keyAccess = await getKeyAccessContext(request);
      const augmentedModels = await filterAdapterModels(keyAccess, augmentModelsWithCapacityAdapter(comboModels, requiredCapabilities, chatSettings), comboModels);
      const adapterAdded = augmentedModels.filter((m) => !comboModels.includes(m));

      if (comboStrategy === "fusion") {
        log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
        return handleFusionChat({
          body,
          models: comboModels,
          handleSingleModel: (b, m, isPanel) => {
            let cleanRawReq = clientRawRequest;
            if (isPanel && clientRawRequest) {
              const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
              cleanRawReq = { ...clientRawRequest, body: cleanBody };
            }
            return handleSingleModelChat(b, m, cleanRawReq, request, apiKey, null, brandModelId);
          },
          log,
          comboName: modelStr,
          judgeModel: comboStrategies[modelStr]?.judgeModel,
          tuning: comboStrategies[modelStr]?.fusionTuning,
        });
      }

      const comboStickyLimit = chatSettings.comboStickyRoundRobinLimit;
      const comboCfg = comboStrategies[modelStr] || {};
      const nestedSession = resolveSessionIdentity({ headers: clientRawRequest?.headers, body });
      const nestedSessionId = nestedSession?.sessionId || null;
      log.info("CHAT", `Combo "${modelStr}" with ${augmentedModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
      return handleComboChat({
        body,
        models: augmentedModels,
        handleSingleModel: withCapacityAdapterStripping(
          (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey, null, brandModelId),
          adapterAdded
        ),
        log,
        comboName: modelStr,
        comboStrategy,
        comboStickyLimit,
        sessionId: nestedSessionId,
        smartPolicy: comboCfg.smartPolicy || "smart",
        sessionSticky: comboCfg.sessionSticky !== false,
        confidenceThreshold: typeof comboCfg.confidenceThreshold === "number" ? comboCfg.confidenceThreshold : 0.8,
        resolveSmartChoice: comboStrategy === "smart"
          ? (b, m) => resolveSmartChoice({
              body: b,
              models: m,
              routerModel: comboCfg.routerModel,
              log,
            })
          : null,
      });
    }
    log.warn("CHAT", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const { provider, model } = modelInfo;

  // applyLive (plan #2): resolve the live system prompt for this request
  // (brand → exact provider+model → whole provider) and inject it into a
  // COPY of the body. This runs before handleChatCore, i.e. before RTK
  // and before translation, so the injected prompt is translated to the
  // provider's format like any client system message. The shared `body`
  // stays untouched: combo members reuse it across attempts, and the
  // clientRawRequest log keeps the client's original request.
  let livePromptText = null;
  let chatBody = body;
  try {
    const livePrompt = await findLivePromptForRequest({ brandModelId, provider, model });
    if (livePrompt) {
      let sourceFormat = null;
      try {
        sourceFormat = (request?.url
          ? detectFormatByEndpoint(new URL(request.url).pathname, body)
          : null) || detectFormat(body);
      } catch {
        sourceFormat = null;
      }
      const applied = applyLivePromptToBody(body, sourceFormat, livePrompt.systemPrompt, livePrompt.mode);
      if (applied.injected) {
        chatBody = applied.body;
        livePromptText = livePrompt.systemPrompt;
        log.info("LIVE", `applyLive ${livePrompt.mode} for ${brandModelId || `${provider}/${model}`}`);
      }
    }
  } catch (e) {
    log?.warn?.("LIVE", `applyLive failed (fail-open, no injection): ${e?.message || e}`);
  }

  // Routing shown in the unified "▶" line (client model → provider/model)

  // Extract userAgent from request
  const userAgent = request?.headers?.get("user-agent") || "";

  // Try with available accounts (fallback on errors)
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;
  let lastHeaders = null;

  // Egress relay rotation state (plan #1): when a 403 Abusive Traffic
  // blames the egress, the loop retries the SAME account through the next
  // relay — the pin + pool override below carry that across iterations.
  // The state is per-request (declared inside handleChat) and is cleared
  // the moment account fallback excludes the pinned connection.
  let relayOverridePoolId = null;
  let relayPinnedConnectionId = null;
  let relayAttempts = 0;
  let relayTriedPoolIds = new Set();

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model, {
      requestedModel: requestedModel || model,
      ...(relayOverridePoolId ? { preferredConnectionId: relayPinnedConnectionId, proxyPoolOverride: relayOverridePoolId } : {}),
    });

    // All accounts unavailable
    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("CHAT", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman, lastHeaders);
      }
      if (excludeConnectionIds.size === 0) {
        log.warn("AUTH", `No active credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.NOT_FOUND, `No active credentials for provider: ${provider}`);
      }
      log.warn("CHAT", "No more accounts available", { provider });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable", lastHeaders);
    }

    // Relay pin lost (pinned account excluded or model-locked) → the next
    // account starts with its own pool and a fresh relay state.
    if (relayPinnedConnectionId && credentials.connectionId !== relayPinnedConnectionId) {
      relayOverridePoolId = null;
      relayPinnedConnectionId = null;
      relayAttempts = 0;
      relayTriedPoolIds = new Set();
    }

    // Account selection shown in the unified "▶" line (acc:...)
    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

    // Ensure real project ID is available for providers that need it (P0 fix: cold miss)
    if ((provider === "antigravity" || provider === "gemini-cli") && !refreshedCredentials.projectId) {
      const pid = await getProjectIdForConnection(credentials.connectionId, refreshedCredentials.accessToken, provider);
      if (pid) {
        refreshedCredentials.projectId = pid;
        // Persist to DB in background so subsequent requests have it immediately
        updateProviderCredentials(credentials.connectionId, { projectId: pid }).catch(() => { });
      }
    }

    // Use shared chatCore
    const chatSettings = await getSettings();
    const providerThinking = (chatSettings.providerThinking || {})[provider] || null;
    const result = await handleChatCore({
      body: { ...chatBody, model: `${provider}/${model}` },
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      log,
      clientRawRequest,
      connectionId: credentials.connectionId,
      userAgent,
      apiKey,
      // Live-prompt text (plan #2): only used to redact the injected
      // prompt out of request details and request logs — the text itself
      // never leaves this process in a stored record.
      livePromptText,
      ccFilterNaming: !!chatSettings.ccFilterNaming,
      // RTK per-model override (plan G9): a boolean entry for this exact
      // "provider/model" in settings.rtkModelOverrides wins over the global
      // rtkEnabled; no entry = global behavior (unchanged).
      rtkEnabled: resolveRtkEnabled(chatSettings, provider, model),
      headroomEnabled: !!chatSettings.headroomEnabled,
      headroomUrl: chatSettings.headroomUrl || DEFAULT_HEADROOM_URL,
      headroomCompressUserMessages: !!chatSettings.headroomCompressUserMessages,
      headroomTimeoutMs: chatSettings.headroomTimeoutMs,
      cavemanEnabled: !!chatSettings.cavemanEnabled,
      cavemanLevel: chatSettings.cavemanLevel || "full",
      ponytailEnabled: !!chatSettings.ponytailEnabled,
      ponytailLevel: chatSettings.ponytailLevel || "full",
      customPromptEnabled: !!chatSettings.customPromptEnabled,
      customPrompt: chatSettings.customPrompt || "",
      pxpipeEnabled: !!chatSettings.pxpipeEnabled,
      pxpipeMinChars: chatSettings.pxpipeMinChars,
      pxpipeTimeoutMs: chatSettings.pxpipeTimeoutMs,
      // Lazily warms the in-process module on first use; null when not installed (fail-open)
      pxpipeTransform: chatSettings.pxpipeEnabled ? await getPxpipeTransform() : null,
      onPxpipeEvent: appendPxpipeEvent,
      providerThinking,
      // Per-provider user overrides (custom headers / connect timeout) from settings
      providerOverrides: (chatSettings.providerOverrides || {})[provider] || null,
      // Detect source format by endpoint + body
      sourceFormatOverride: request?.url ? detectFormatByEndpoint(new URL(request.url).pathname, body) : null,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          ...newCreds,
          existingProviderSpecificData: credentials.providerSpecificData,
          testStatus: "active"
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model);
        // "Consecutive" strikes: a success clears the breaker for this pair.
        clearAntigravityStrikes(credentials.connectionId, model);
      }
    });

    if (result.success) {
      // A request that went through a relay clears that relay's fail streak
      // (best-effort bookkeeping; never breaks the response path).
      const okPoolId = refreshedCredentials?.providerSpecificData?.connectionProxyPoolId;
      if (okPoolId) recordRelaySuccess(okPoolId).catch(() => {});
      return result.response;
    }

    // Egress relay rotation (plan #1, G1 taxonomy): a 403 Abusive Traffic
    // blames the EGRESS, not the account — ban the pool and retry the SAME
    // account via the next relay for this provider. A 400/11128 blames the
    // REQUEST (auto-patch headers already ran) — return it without touching
    // relay or account state. 429 stays on the existing account-fallback
    // path below (per-account quota — rotating the relay would not help).
    {
      const egress = classifyEgressError(result.status, result.error);
      if (egress.action === EGRESS_ACTIONS.REQUEST_ERROR) {
        return result.response;
      }
      if (
        egress.action === EGRESS_ACTIONS.ROTATE_RELAY &&
        relayAttempts < EGRESS_ROTATE_MAX_ATTEMPTS &&
        isEgressAutoRotateEnabled(chatSettings, provider)
      ) {
        const currentPoolId = refreshedCredentials?.providerSpecificData?.connectionProxyPoolId || null;
        if (currentPoolId) relayTriedPoolIds.add(currentPoolId);
        const nextPool = await pickNextRelayPool({ provider, excludePoolIds: [...relayTriedPoolIds] });
        if (nextPool) {
          await markRelayBanned(currentPoolId, { status: result.status, code: egress.code });
          relayOverridePoolId = nextPool.id;
          relayPinnedConnectionId = credentials.connectionId;
          relayTriedPoolIds.add(nextPool.id);
          relayAttempts += 1;
          log.warn("EGRESS", `⇄ RELAY:${currentPoolId?.slice(0, 8) || "direct"} BANNED (${result.status}) → ${nextPool.id.slice(0, 8)} (${nextPool.name || nextPool.type || "relay"})`);
          continue;
        }
        // No other relay for this provider: fall through to account fallback.
      }
    }

    // Antigravity 409/429: refresh live quota to get exact resetAt before locking
    let quotaResetMs = null;
    let resetsAtMs = result.resetsAtMs;
    if (provider === "antigravity" && (result.status === 409 || result.status === 429)) {
      quotaResetMs = await handleAntigravityQuotaError(
        credentials.connectionId, result.status, model,
        refreshedCredentials.accessToken, credentials.providerSpecificData
      );
      if (quotaResetMs) resetsAtMs = quotaResetMs;
    }

    // Exhausted Antigravity model is blocked only in RAM cache until upstream resetAt.
    // Do not persist a modelLock_* for this path.
    const shouldFallback = provider === "antigravity" && quotaResetMs
      ? true
      : (await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model, resetsAtMs)).shouldFallback;

    if (shouldFallback) {
      log.warn("FALLBACK", `⇄ ACC:${credentials.connectionName} UNAVAILABLE (${result.status}) → NEXT ACCOUNT`);
      excludeConnectionIds.add(credentials.connectionId);
      // The account changed, so any relay pin/override dies with it — the
      // next account starts with its own pool and a fresh relay state.
      relayOverridePoolId = null;
      relayPinnedConnectionId = null;
      relayAttempts = 0;
      relayTriedPoolIds = new Set();
      lastError = result.error;
      lastStatus = result.status;
      lastHeaders = upstreamResponseHeaders(result.response?.headers);
      continue;
    }

    return result.response;
  }
}
