// ============================================================
// 🧠 services/shared/utils/ai-service.js
// Resilient AI requester (OpenRouter) — ai-config–driven
// ============================================================

import aiConfig from "./ai-config.js";
import { safeRouteLog } from "../../../logger.js";
import { info, error as logError } from "../../../logger.js";
import { recordProviderOutcome } from "./operationalExcellence.js";
import { compressForOpenRouter } from "./headroom.js";

function getOpenRouterBaseUrl() {
  return process.env.OPENROUTER_BASE_URL || process.env.OPENROUTER_API_BASE || "https://openrouter.ai/api/v1";
}

function getOpenRouterChatEndpoint() {
  return `${getOpenRouterBaseUrl().replace(/\/+$/, "")}/chat/completions`;
}
function finiteEnvNumber(name, fallback, { min = -Infinity, max = Infinity, integer = false } = {}) {
  const raw = process.env[name];
  const value = raw === undefined || raw === null || raw === "" ? Number(fallback) : Number(raw);
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    return Number(fallback);
  }
  return value;
}

const DEFAULT_MAX_TOKENS = finiteEnvNumber("AI_MAX_TOKENS", 4096, { min: 1, integer: true });
const DEFAULT_TEMPERATURE = finiteEnvNumber("AI_TEMPERATURE", aiConfig?.commonParams?.temperature ?? 0.7, { min: 0, max: 2 });
const DEFAULT_TIMEOUT_MS = finiteEnvNumber("AI_TIMEOUT", aiConfig?.commonParams?.timeout ?? 90000, { min: 1, integer: true });
const DEFAULT_TOP_P = finiteEnvNumber("AI_TOP_P", aiConfig?.commonParams?.top_p ?? 0.9, { min: 0, max: 1 });
// Retries are deliberately configurable. Do not impose a hidden minimum: a
// production operator must be able to cap paid retries when budget is tight.
const MAX_RETRIES = finiteEnvNumber("AI_MAX_RETRIES", 4, { min: 0, integer: true });
const RETRY_BASE_MS = finiteEnvNumber("AI_RETRY_BASE_MS", 750, { min: 0, integer: true });
const EMPTY_COMPLETION_RETRIES_PER_PROVIDER = finiteEnvNumber("AI_EMPTY_COMPLETION_RETRIES_PER_PROVIDER", 1, { min: 0, integer: true });
const __aiRouteCallsBySession = new Map();
const __lastSuccessProvider = new Map();

function __sid(sessionIdLike) {
  if (!sessionIdLike) return "unknown";
  if (typeof sessionIdLike === "object") return sessionIdLike.sessionId || "unknown";
  return String(sessionIdLike);
}

function __record(sessionId, routeName, provider, model) {
  const sid = __sid(sessionId);
  if (!__aiRouteCallsBySession.has(sid)) __aiRouteCallsBySession.set(sid, []);
  __aiRouteCallsBySession.get(sid).push({ routeName, provider, model });
}

function __maybePrintSummary(sessionId, routeName) {
  const isEnd = routeName === "scriptOutro" || routeName === "generateComposedEpisode";
  if (!isEnd) return;
  const sid = __sid(sessionId);
  const calls = __aiRouteCallsBySession.get(sid) || [];
  if (!calls.length) return;
  const header = `🧠 Script Generator Summary — ${sid}`;
  const sep = "────────────────────────────────────────────";
  const lines = calls.map(({ routeName, provider }) => `${routeName.padEnd(18)}→ ${provider}`);
  info([header, sep, ...lines, sep, `Total Calls: ${calls.length}`].join("\n"));
  __aiRouteCallsBySession.delete(sid);
}

function resolveRouteKey(routeName) {
  if (aiConfig.routeModels[routeName]) return routeName;
  if (routeName && routeName.startsWith("scriptMain-")) return "scriptMain";
  return routeName;
}

function getProviderChainForRoute(routeKey) {
  const chain = aiConfig?.routeModels?.[routeKey];
  if (!Array.isArray(chain) || chain.length === 0) throw new Error(`No model route defined for: ${routeKey}`);
  const cached = __lastSuccessProvider.get(routeKey);
  if (cached && chain.includes(cached)) return [cached, ...chain.filter((provider) => provider !== cached)];
  return chain;
}

function isRetiredModel(value) {
  const model = String(value || "").trim();
  return /^deepseek\//i.test(model) || /^openai\/gpt-5\.6-luna$/i.test(model);
}

function looksLikeTemplatePlaceholder(value) {
  return /^\s*\{\{\s*secret\.[^}]+\}\}\s*$/i.test(String(value || ""));
}

function firstEnvValue(names = []) {
  let firstPlaceholder;
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== null && String(value).trim()) {
      const trimmed = String(value).trim();
      if (looksLikeTemplatePlaceholder(trimmed)) {
        if (!firstPlaceholder) firstPlaceholder = { name, value: trimmed };
        continue;
      }
      return { name, value: trimmed };
    }
  }
  return firstPlaceholder || { name: undefined, value: undefined };
}

function getProviderConfig(providerId) {
  const conf = aiConfig?.models?.[providerId];
  if (!conf) return null;

  const resolvedModel = firstEnvValue(Array.isArray(conf.modelEnvNames) ? conf.modelEnvNames : []);
  const resolvedKey = firstEnvValue(Array.isArray(conf.keyEnvNames) ? conf.keyEnvNames : []);
  const model = resolvedModel.value || conf.name;
  const apiKey = resolvedKey.value || conf.apiKey;

  // Retired model families are blocked even if stale Koyeb/process env values survive an older deployment.
  // This keeps the canonical model policy authoritative at runtime, not just in templates.
  if (isRetiredModel(model)) return null;
  if (!model || !apiKey) return null;
  if (looksLikeTemplatePlaceholder(model) || looksLikeTemplatePlaceholder(apiKey)) return null;

  return {
    ...conf,
    providerId,
    name: model,
    apiKey,
    modelEnv: resolvedModel.name || conf.modelEnv,
    apiKeyEnv: resolvedKey.name || conf.apiKeyEnv,
  };
}

function maskSecretishText(value = "") {
  return String(value)
    .replace(/sk-or-[A-Za-z0-9_-]{8,}/g, "sk-or-***")
    .replace(/github_pat_[A-Za-z0-9_]+/g, "github_pat_***")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer ***")
    .replace(/\{\{\s*secret\.[^}]+\}\}/gi, "{{ secret.*** }}");
}

function safeSnippet(value = "", max = 700) {
  const text = maskSecretishText(value).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function parseBoolean(value, fallback = undefined) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalised = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "y"].includes(normalised)) return true;
  if (["0", "false", "no", "off", "n"].includes(normalised)) return false;
  return fallback;
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getOpenRouterProviderOptions({ response_format, routeKey } = {}) {
  const provider = {};
  const sortBy = String(process.env.OPENROUTER_SORT_BY || "").trim().toLowerCase();
  if (["price", "throughput", "latency"].includes(sortBy)) {
    provider.sort = sortBy;
  }

  const order = parseCsv(process.env.OPENROUTER_PROVIDER_ORDER);
  if (order.length > 0) provider.order = order;

  const only = parseCsv(process.env.OPENROUTER_PROVIDER_ONLY);
  if (only.length > 0) provider.only = only;

  const ignore = parseCsv(process.env.OPENROUTER_PROVIDER_IGNORE);
  if (ignore.length > 0) provider.ignore = ignore;

  const fallbacks = parseBoolean(process.env.OPENROUTER_ENABLE_FALLBACKS);
  if (fallbacks !== undefined) provider.allow_fallbacks = fallbacks;

  const requireParametersOverride = parseBoolean(process.env.OPENROUTER_REQUIRE_PARAMETERS);
  const requireParametersForJson = parseBoolean(process.env.OPENROUTER_REQUIRE_PARAMETERS_FOR_JSON, true);
  const requireParameters = requireParametersOverride !== undefined
    ? requireParametersOverride
    : Boolean(response_format && requireParametersForJson);
  if (requireParameters) provider.require_parameters = true;

  const isCommsHubRoute = String(routeKey || "").startsWith("commsHub");
  const commsDataCollection = String(process.env.COMMS_HUB_OPENROUTER_DATA_COLLECTION || "deny").trim().toLowerCase();
  const dataCollection = isCommsHubRoute
    ? commsDataCollection
    : String(process.env.OPENROUTER_DATA_COLLECTION || "").trim().toLowerCase();
  if (["allow", "deny"].includes(dataCollection)) provider.data_collection = dataCollection;

  if (isCommsHubRoute) {
    const zdrOnly = parseBoolean(process.env.COMMS_HUB_OPENROUTER_ZDR_ONLY, true) !== false;
    if (zdrOnly) provider.zdr = true;
  }

  return Object.keys(provider).length ? provider : undefined;
}

function getServiceTier() {
  const value = String(process.env.OPENROUTER_SERVICE_TIER || "").trim().toLowerCase();
  if (["auto", "default", "flex", "priority"].includes(value)) return value;
  return undefined;
}

// Reasoning-capable models can spend part of max_tokens on
// internal "reasoning" tokens before writing any visible content. If
// max_tokens is tight, the reasoning step can consume the entire budget and
// the API returns HTTP 200 with a *successful* response whose message.content
// is simply "" (usage.completion_tokens still shows the reasoning spend).
// Capping reasoning effort keeps headroom free for the actual answer.
function getReasoningOptions() {
  const raw = String(process.env.OPENROUTER_REASONING_EFFORT || "low").trim().toLowerCase();
  if (!raw || raw === "none" || raw === "off") return undefined;
  if (["minimal", "low", "medium", "high"].includes(raw)) return { effort: raw };
  const maxTokens = Number(raw);
  if (Number.isFinite(maxTokens) && maxTokens > 0) return { max_tokens: maxTokens };
  return { effort: "low" };
}

function shouldLogUsage() {
  return parseBoolean(process.env.AI_USAGE_LOG_ENABLED, true) !== false;
}

function parseRetryAfterMs(value) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(0, Math.ceil(seconds * 1000));
  const dateMs = Date.parse(raw);
  if (!Number.isFinite(dateMs)) return 0;
  return Math.max(0, dateMs - Date.now());
}

function makeOpenRouterError(status, body, providerId, retryAfterHeader) {
  const err = new Error(`OpenRouter ${status} for provider ${providerId}: ${safeSnippet(body)}`);
  err.name = "AIProviderRequestError";
  err.status = status;
  err.providerId = providerId;
  err.bodySnippet = safeSnippet(body);
  err.retryAfterMs = parseRetryAfterMs(retryAfterHeader);
  const numericStatus = Number(status);
  const transientHttp = [408, 409, 425, 429].includes(numericStatus) || numericStatus >= 500;
  err.nonRetryable = Number.isFinite(numericStatus) && !transientHttp;
  return err;
}

function isParameterCompatibilityError(error = {}) {
  const status = Number(error?.status || 0);
  if (![400, 404, 422].includes(status)) return false;
  const text = [error?.message, error?.bodySnippet].filter(Boolean).join(" ").toLowerCase();
  return /no endpoints found.*requested parameters|cannot handle.*parameters|unsupported parameter|response[_ ]format|structured output|output_config\.format\.schema|minitems|json schema/.test(text);
}

function extractMessageContent(json) {
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        return "";
      })
      .join("")
      .trim();
  }
  return "";
}

async function callOpenRouter({ routeKey, providerId, model, apiKey, messages, max_tokens, temperature, top_p, response_format, headers, timeoutMs, reasoning, signal, relaxedParameters = false }) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : Object.assign(new Error("OpenRouter request aborted"), { name: "AbortError", code: "AI_REQUEST_ABORTED" });
  }

  // OpenRouter still accepts max_tokens for compatibility, but the current
  // Chat Completions contract deprecates it in favour of max_completion_tokens.
  const payload = { model, messages, max_completion_tokens: max_tokens };
  // Provider privacy/routing controls are retained even during compatibility
  // relaxation. Relaxing optional model parameters must never relax Comms Hub
  // ZDR or data-collection policy.
  const providerOptions = getOpenRouterProviderOptions({ response_format: relaxedParameters ? undefined : response_format, routeKey });
  if (providerOptions) payload.provider = providerOptions;

  if (!relaxedParameters) {
    payload.temperature = temperature;
    payload.top_p = top_p;
    if (response_format) payload.response_format = response_format;

    const serviceTier = getServiceTier();
    if (serviceTier) payload.service_tier = serviceTier;

    const effectiveReasoning = reasoning === undefined ? getReasoningOptions() : reasoning;
    if (effectiveReasoning) payload.reasoning = effectiveReasoning;
  }

  const serviceTier = relaxedParameters ? undefined : payload.service_tier;

  const reqHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    ...(aiConfig?.headers || {}),
    ...(headers || {}),
  };
  const effectiveTimeoutMs = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Number(timeoutMs)
    : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const onExternalAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener?.("abort", onExternalAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, effectiveTimeoutMs);
  const startedAt = Date.now();
  try {
    const res = await fetch(getOpenRouterChatEndpoint(), { method: "POST", headers: reqHeaders, body: JSON.stringify(payload), signal: controller.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw makeOpenRouterError(res.status, text, providerId, res.headers?.get?.("retry-after"));
    }
    const json = await res.json();
    const content = extractMessageContent(json);
    const usage = json?.usage || null;

    if (!content) {
      const finishReason = json?.choices?.[0]?.finish_reason;
      const reasonNote =
        finishReason === "length"
          ? "the model's reasoning consumed the entire completion-token budget before producing visible output"
          : "the model returned no visible completion content";
      const emptyErr = new Error(
        `OpenRouter returned an empty completion for provider ${providerId} (model ${model}): ${reasonNote} ` +
          `[finish_reason=${finishReason || "unknown"}, completion_tokens=${usage?.completion_tokens ?? "unknown"}]`
      );
      emptyErr.name = "AIEmptyCompletionError";
      emptyErr.providerId = providerId;
      emptyErr.status = "empty_completion";
      emptyErr.nonRetryable = false;
      throw emptyErr;
    }

    return {
      content,
      usage,
      id: json?.id,
      model: json?.model || model,
      serviceTier: json?.service_tier || serviceTier,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : Object.assign(new Error("OpenRouter request aborted"), { name: "AbortError", code: "AI_REQUEST_ABORTED" });
    }
    if (timedOut || err?.name === "AbortError") {
      const timeoutErr = new Error(`OpenRouter request timed out after ${effectiveTimeoutMs}ms for provider ${providerId}`);
      timeoutErr.code = "OPENROUTER_TIMEOUT";
      timeoutErr.providerId = providerId;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.("abort", onExternalAbort);
  }
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(signal.reason instanceof Error ? signal.reason : Object.assign(new Error("AI request aborted"), { name: "AbortError", code: "AI_REQUEST_ABORTED" }));
    return;
  }
  const timer = setTimeout(() => {
    signal?.removeEventListener?.("abort", onAbort);
    resolve();
  }, ms);
  function onAbort() {
    clearTimeout(timer);
    reject(signal.reason instanceof Error ? signal.reason : Object.assign(new Error("AI request aborted"), { name: "AbortError", code: "AI_REQUEST_ABORTED" }));
  }
  signal?.addEventListener?.("abort", onAbort, { once: true });
});

export async function resilientRequest(routeName, {
  sessionId,
  section,
  messages,
  max_tokens = DEFAULT_MAX_TOKENS,
  temperature = DEFAULT_TEMPERATURE,
  top_p = DEFAULT_TOP_P,
  headers,
  response_format,
  timeoutMs,
  maxRetries,
  retryBaseMs,
  reasoning,
  signal,
  returnMetadata = false,
  validateContent,
} = {}) {
  const routeKey = resolveRouteKey(routeName);
  const chain = getProviderChainForRoute(routeKey);
  const requestedMaxRetries = Number.isFinite(Number(maxRetries)) ? Number(maxRetries) : MAX_RETRIES;
  const effectiveMaxRetries = Math.max(0, requestedMaxRetries);
  const effectiveRetryBaseMs = Number.isFinite(Number(retryBaseMs)) ? Number(retryBaseMs) : RETRY_BASE_MS;
  let lastErr;
  const attempted = [];
  const attemptedProviderTargets = new Set();

  for (const providerId of chain) {
    const provider = getProviderConfig(providerId);
    if (!provider) {
      attempted.push({ providerId, status: "misconfigured" });
      logError("ai.provider.misconfigured", { routeName, routeKey, providerId, modelEnvNames: aiConfig?.models?.[providerId]?.modelEnvNames, keyEnvNames: aiConfig?.models?.[providerId]?.keyEnvNames });
      continue;
    }

    const targetKey = `${provider.name}::${provider.apiKeyEnv || provider.providerId || providerId}`;
    if (attemptedProviderTargets.has(targetKey)) {
      attempted.push({ providerId, model: provider.name, status: "duplicate-alias-skipped" });
      continue;
    }
    attemptedProviderTargets.add(targetKey);

    try { safeRouteLog({ routeName, routeKey, provider: providerId, model: provider.name }); } catch {}
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : Object.assign(new Error("AI request aborted"), { name: "AbortError", code: "AI_REQUEST_ABORTED" });
    }
    const headroom = await compressForOpenRouter({ routeName, routeKey, model: provider.name, messages, signal });
    const providerMessages = headroom.messages;
    let compatibilityRelaxationUsed = false;
    for (let attempt = 0; attempt <= effectiveMaxRetries; attempt++) {
      try {
        const result = await callOpenRouter({ routeKey, providerId, model: provider.name, apiKey: provider.apiKey, messages: providerMessages, max_tokens, temperature, top_p, response_format, headers, timeoutMs, reasoning, signal });
        if (typeof validateContent === "function") await validateContent(result.content, { routeName, routeKey, providerId, model: result.model || provider.name });
        if (shouldLogUsage()) {
          info("ai.request.usage", {
            routeName,
            routeKey,
            provider: providerId,
            requestedModel: provider.name,
            returnedModel: result.model,
            durationMs: result.durationMs,
            serviceTier: result.serviceTier,
            parameterMode: "standard",
            promptTokens: result.usage?.prompt_tokens,
            completionTokens: result.usage?.completion_tokens,
            totalTokens: result.usage?.total_tokens,
            cost: result.usage?.cost,
            headroomCompressed: headroom.compressed,
            headroomTokensSaved: headroom.tokensSaved || 0,
            headroomReason: headroom.reason || null,
          });
        }
        recordProviderOutcome({ routeKey, provider: providerId, ok: true, durationMs: result.durationMs, status: "success" });
        __record(sessionId, routeName, providerId, result.model || provider.name);
        __lastSuccessProvider.set(routeKey, providerId);
        __maybePrintSummary(sessionId, routeName);
        return returnMetadata ? {
          content: result.content,
          providerId,
          model: result.model || provider.name,
          durationMs: result.durationMs,
          usage: result.usage || null,
          serviceTier: result.serviceTier || null,
          routeKey,
          headroom: {
            compressed: headroom.compressed,
            tokensBefore: headroom.tokensBefore,
            tokensAfter: headroom.tokensAfter,
            tokensSaved: headroom.tokensSaved || 0,
            compressionRatio: headroom.compressionRatio,
            reason: headroom.reason,
          },
        } : result.content;
      } catch (err) {
        lastErr = err;
        if (signal?.aborted) {
          throw signal.reason instanceof Error ? signal.reason : err;
        }

        // Provider routing can select an endpoint that supports the model but
        // not one of the optional request parameters. Retry the same model
        // once with the portable core payload before abandoning it. The
        // prompts still require JSON, and deterministic parsers/validators
        // remain the final authority.
        if (!compatibilityRelaxationUsed && isParameterCompatibilityError(err)) {
          compatibilityRelaxationUsed = true;
          info("ai.request.parameter_relaxation", {
            routeName,
            routeKey,
            provider: providerId,
            model: provider.name,
            status: err?.status || null,
          });
          try {
            const relaxed = await callOpenRouter({
              routeKey,
              providerId,
              model: provider.name,
              apiKey: provider.apiKey,
              messages: providerMessages,
              max_tokens,
              headers,
              timeoutMs,
              signal,
              relaxedParameters: true,
            });
            if (typeof validateContent === "function") await validateContent(relaxed.content, { routeName, routeKey, providerId, model: relaxed.model || provider.name });
            if (shouldLogUsage()) {
              info("ai.request.usage", {
                routeName,
                routeKey,
                provider: providerId,
                requestedModel: provider.name,
                returnedModel: relaxed.model,
                durationMs: relaxed.durationMs,
                serviceTier: relaxed.serviceTier,
                parameterMode: "relaxed",
                promptTokens: relaxed.usage?.prompt_tokens,
                completionTokens: relaxed.usage?.completion_tokens,
                totalTokens: relaxed.usage?.total_tokens,
                cost: relaxed.usage?.cost,
                headroomCompressed: headroom.compressed,
                headroomTokensSaved: headroom.tokensSaved || 0,
                headroomReason: headroom.reason || null,
              });
            }
            recordProviderOutcome({ routeKey, provider: providerId, ok: true, durationMs: relaxed.durationMs, status: "success-relaxed" });
            __record(sessionId, routeName, providerId, relaxed.model || provider.name);
            __lastSuccessProvider.set(routeKey, providerId);
            __maybePrintSummary(sessionId, routeName);
            return returnMetadata ? {
              content: relaxed.content,
              providerId,
              model: relaxed.model || provider.name,
              durationMs: relaxed.durationMs,
              usage: relaxed.usage || null,
              serviceTier: relaxed.serviceTier || null,
              routeKey,
              parameterMode: "relaxed",
              headroom: {
                compressed: headroom.compressed,
                tokensBefore: headroom.tokensBefore,
                tokensAfter: headroom.tokensAfter,
                tokensSaved: headroom.tokensSaved || 0,
                compressionRatio: headroom.compressionRatio,
                reason: headroom.reason,
              },
            } : relaxed.content;
          } catch (relaxedError) {
            lastErr = relaxedError;
            if (signal?.aborted) {
              throw signal.reason instanceof Error ? signal.reason : relaxedError;
            }
            err = relaxedError;
          }
        }

        recordProviderOutcome({ routeKey, provider: providerId, ok: false, durationMs: 0, status: err?.status || err?.code || "failed" });
        attempted.push({ providerId, model: provider.name, attempt: attempt + 1, status: err?.status || err?.code || "failed", message: safeSnippet(err?.message || String(err), 500) });
        // A request that has already consumed the full timeout window should
        // fail over to the next configured provider instead of repeating the
        // same slow target for another full timeout cycle.
        const timedOut = err?.code === "OPENROUTER_TIMEOUT";
        const emptyCompletion = err?.status === "empty_completion";
        const invalidCompletion = err?.status === "invalid_completion" || err?.code === "AI_INVALID_STRUCTURED_OUTPUT";
        const emptyCompletionBudgetExhausted = emptyCompletion && attempt >= EMPTY_COMPLETION_RETRIES_PER_PROVIDER;
        // Comms Hub's free providers are opportunistic capacity. A shared-pool
        // rate limit or an endpoint/data-policy mismatch should immediately
        // advance to the next configured model rather than making a website
        // visitor wait through retries that cannot improve this request.
        const commsFreeUnavailable = String(routeKey || "").startsWith("commsHub")
          && String(providerId || "").startsWith("commsFree")
          && [404, 429].includes(Number(err?.status));
        const retryable = !timedOut && !invalidCompletion && !emptyCompletionBudgetExhausted && !commsFreeUnavailable && !err?.nonRetryable && attempt < effectiveMaxRetries;
        const exponentialWait = effectiveRetryBaseMs * Math.pow(2, attempt);
        const jitter = Math.floor(exponentialWait * (0.15 * Math.random()));
        const localWait = exponentialWait + jitter;
        // OpenRouter explicitly asks raw-fetch clients to honour Retry-After on
        // 429/503. Cap the sleep so a malformed provider header cannot stall a job forever.
        const wait = Math.min(120_000, Math.max(localWait, Number(err?.retryAfterMs || 0)));
        const failover = timedOut || invalidCompletion || emptyCompletionBudgetExhausted || commsFreeUnavailable;
        logError(failover ? "ai.request.provider_failover" : "ai.request.retry", {
          routeName,
          routeKey,
          provider: providerId,
          attempt: attempt + 1,
          wait: retryable ? wait : 0,
          retryable,
          failover,
          failoverReason: timedOut
            ? "timeout"
            : invalidCompletion
              ? "invalid_completion"
              : emptyCompletionBudgetExhausted
                ? "empty_completion_budget_exhausted"
                : commsFreeUnavailable
                  ? "free_provider_unavailable"
                  : undefined,
          status: err?.status,
          message: safeSnippet(err?.message || String(err), 500),
        });
        if (!retryable) break;
        await sleep(wait, signal);
      }
    }
  }

  __maybePrintSummary(sessionId, routeName);
  const err = lastErr || new Error(`All providers failed for route: ${routeKey}`);
  err.routeKey = routeKey;
  err.attemptedProviders = attempted;
  throw err;
}

export function getProviderDiagnosticsForRoute(routeName) {
  const routeKey = resolveRouteKey(routeName);
  const chain = getProviderChainForRoute(routeKey);

  return {
    routeName,
    routeKey,
    configuredProviders: chain.map((providerId) => {
      const conf = aiConfig?.models?.[providerId] || {};
      const resolvedModel = firstEnvValue(Array.isArray(conf.modelEnvNames) ? conf.modelEnvNames : []);
      const resolvedKey = firstEnvValue(Array.isArray(conf.keyEnvNames) ? conf.keyEnvNames : []);
      const modelValue = resolvedModel.value || conf.name;
      const keyValue = resolvedKey.value || conf.apiKey;
      return {
        providerId,
        model: modelValue || undefined,
        modelEnv: resolvedModel.name || (Array.isArray(conf.modelEnvNames) ? conf.modelEnvNames.join("|") : undefined),
        apiKeyEnv: resolvedKey.name || (Array.isArray(conf.keyEnvNames) ? conf.keyEnvNames.join("|") : undefined),
        hasModel: Boolean(modelValue),
        hasApiKey: Boolean(keyValue),
        configured: Boolean(getProviderConfig(providerId)),
        unresolvedTemplate: looksLikeTemplatePlaceholder(modelValue) || looksLikeTemplatePlaceholder(keyValue),
      };
    }),
  };
}

export default { resilientRequest, getProviderDiagnosticsForRoute };
