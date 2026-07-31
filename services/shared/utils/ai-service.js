// ============================================================
// 🧠 services/shared/utils/ai-service.js
// Resilient AI requester (OpenRouter) — ai-config–driven
// ============================================================

import aiConfig from "./ai-config.js";
import { safeRouteLog } from "../../../logger.js";
import { info, error as logError } from "../../../logger.js";
import { recordProviderOutcome } from "./operationalExcellence.js";

function getOpenRouterBaseUrl() {
  return process.env.OPENROUTER_BASE_URL || process.env.OPENROUTER_API_BASE || "https://openrouter.ai/api/v1";
}

function getOpenRouterChatEndpoint() {
  return `${getOpenRouterBaseUrl().replace(/\/+$/, "")}/chat/completions`;
}
const DEFAULT_MAX_TOKENS = Number(process.env.AI_MAX_TOKENS || 4096);
const DEFAULT_TEMPERATURE = Number(process.env.AI_TEMPERATURE ?? aiConfig?.commonParams?.temperature ?? 0.7);
const DEFAULT_TIMEOUT_MS = Number(process.env.AI_TIMEOUT ?? aiConfig?.commonParams?.timeout ?? 90000);
const DEFAULT_TOP_P = Number(process.env.AI_TOP_P ?? aiConfig?.commonParams?.top_p ?? 0.9);
// 4 retries + the initial attempt = 5 total attempts per provider before
// failover/failure, in line with the platform-wide 5-attempt floor.
const MAX_RETRIES = Math.max(4, Number(process.env.AI_MAX_RETRIES ?? 4));
const RETRY_BASE_MS = Number(process.env.AI_RETRY_BASE_MS ?? 750);
const EMPTY_COMPLETION_RETRIES_PER_PROVIDER = Math.max(0, Number(process.env.AI_EMPTY_COMPLETION_RETRIES_PER_PROVIDER ?? 1));
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
  return /^deepseek\//i.test(String(value || "").trim());
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

  // DeepSeek has been retired from AIMS production routing. This hard guard
  // also neutralises stale Koyeb/process env values left behind from older deployments.
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

function getOpenRouterProviderOptions({ response_format } = {}) {
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

  const dataCollection = String(process.env.OPENROUTER_DATA_COLLECTION || "").trim().toLowerCase();
  if (["allow", "deny"].includes(dataCollection)) provider.data_collection = dataCollection;

  return Object.keys(provider).length ? provider : undefined;
}

function getServiceTier() {
  const value = String(process.env.OPENROUTER_SERVICE_TIER || "").trim().toLowerCase();
  if (["auto", "default", "flex", "priority"].includes(value)) return value;
  return undefined;
}

// Reasoning-capable models (for example openai/gpt-5.6-luna) spend part of max_tokens on
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

function makeOpenRouterError(status, body, providerId) {
  const err = new Error(`OpenRouter ${status} for provider ${providerId}: ${safeSnippet(body)}`);
  err.name = "AIProviderRequestError";
  err.status = status;
  err.providerId = providerId;
  err.bodySnippet = safeSnippet(body);
  const numericStatus = Number(status);
  const transientHttp = [408, 409, 425, 429].includes(numericStatus) || numericStatus >= 500;
  err.nonRetryable = Number.isFinite(numericStatus) && !transientHttp;
  return err;
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

async function callOpenRouter({ providerId, model, apiKey, messages, max_tokens, temperature, top_p, response_format, headers, timeoutMs, reasoning }) {
  const payload = { model, messages, max_tokens, temperature, top_p };
  if (response_format) payload.response_format = response_format;

  const providerOptions = getOpenRouterProviderOptions({ response_format });
  if (providerOptions) payload.provider = providerOptions;

  const serviceTier = getServiceTier();
  if (serviceTier) payload.service_tier = serviceTier;

  const effectiveReasoning = reasoning === undefined ? getReasoningOptions() : reasoning;
  if (effectiveReasoning) payload.reasoning = effectiveReasoning;

  const reqHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    ...(aiConfig?.headers || {}),
    ...(headers || {}),
  };
  const effectiveTimeoutMs = Number(timeoutMs || DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), effectiveTimeoutMs);
  const startedAt = Date.now();
  try {
    const res = await fetch(getOpenRouterChatEndpoint(), { method: "POST", headers: reqHeaders, body: JSON.stringify(payload), signal: controller.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw makeOpenRouterError(res.status, text, providerId);
    }
    const json = await res.json();
    const content = extractMessageContent(json);
    const usage = json?.usage || null;

    if (!content) {
      const finishReason = json?.choices?.[0]?.finish_reason;
      const reasonNote =
        finishReason === "length"
          ? "the model's reasoning consumed the entire max_tokens budget before producing visible output"
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
    if (err?.name === "AbortError") {
      const timeoutErr = new Error(`OpenRouter request timed out after ${effectiveTimeoutMs}ms for provider ${providerId}`);
      timeoutErr.code = "OPENROUTER_TIMEOUT";
      timeoutErr.providerId = providerId;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
} = {}) {
  const routeKey = resolveRouteKey(routeName);
  const chain = getProviderChainForRoute(routeKey);
  const requestedMaxRetries = Number.isFinite(Number(maxRetries)) ? Number(maxRetries) : MAX_RETRIES;
  const effectiveMaxRetries = Math.max(4, requestedMaxRetries);
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
    for (let attempt = 0; attempt <= effectiveMaxRetries; attempt++) {
      try {
        const result = await callOpenRouter({ providerId, model: provider.name, apiKey: provider.apiKey, messages, max_tokens, temperature, top_p, response_format, headers, timeoutMs, reasoning });
        if (shouldLogUsage()) {
          info("ai.request.usage", {
            routeName,
            routeKey,
            provider: providerId,
            requestedModel: provider.name,
            returnedModel: result.model,
            durationMs: result.durationMs,
            serviceTier: result.serviceTier,
            promptTokens: result.usage?.prompt_tokens,
            completionTokens: result.usage?.completion_tokens,
            totalTokens: result.usage?.total_tokens,
            cost: result.usage?.cost,
          });
        }
        recordProviderOutcome({ routeKey, provider: providerId, ok: true, durationMs: result.durationMs, status: "success" });
        __record(sessionId, routeName, providerId, result.model || provider.name);
        __lastSuccessProvider.set(routeKey, providerId);
        __maybePrintSummary(sessionId, routeName);
        return result.content;
      } catch (err) {
        lastErr = err;
        recordProviderOutcome({ routeKey, provider: providerId, ok: false, durationMs: 0, status: err?.status || err?.code || "failed" });
        attempted.push({ providerId, model: provider.name, attempt: attempt + 1, status: err?.status || err?.code || "failed", message: safeSnippet(err?.message || String(err), 500) });
        // A request that has already consumed the full timeout window should
        // fail over to the next configured provider instead of repeating the
        // same slow target for another full timeout cycle.
        const timedOut = err?.code === "OPENROUTER_TIMEOUT";
        const emptyCompletion = err?.status === "empty_completion";
        const emptyCompletionBudgetExhausted = emptyCompletion && attempt >= EMPTY_COMPLETION_RETRIES_PER_PROVIDER;
        const retryable = !timedOut && !emptyCompletionBudgetExhausted && !err?.nonRetryable && attempt < effectiveMaxRetries;
        const exponentialWait = effectiveRetryBaseMs * Math.pow(2, attempt);
        const jitter = Math.floor(exponentialWait * (0.15 * Math.random()));
        const wait = exponentialWait + jitter;
        const failover = timedOut || emptyCompletionBudgetExhausted;
        logError(failover ? "ai.request.provider_failover" : "ai.request.retry", {
          routeName,
          routeKey,
          provider: providerId,
          attempt: attempt + 1,
          wait: retryable ? wait : 0,
          retryable,
          failover,
          failoverReason: timedOut ? "timeout" : emptyCompletionBudgetExhausted ? "empty_completion_budget_exhausted" : undefined,
          status: err?.status,
          message: safeSnippet(err?.message || String(err), 500),
        });
        if (!retryable) break;
        await sleep(wait);
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
