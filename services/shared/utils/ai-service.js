// ============================================================
// 🧠 services/shared/utils/ai-service.js
// Resilient AI requester (OpenRouter) — ai-config–driven
// ============================================================

import aiConfig from "./ai-config.js";
import { safeRouteLog } from "../../../logger.js";
import { info, error as logError } from "../../../logger.js";

const OPENROUTER_BASE = process.env.OPENROUTER_API_BASE || "https://openrouter.ai/api/v1";
const ENDPOINT = `${OPENROUTER_BASE.replace(/\/+$/, "")}/chat/completions`;
const DEFAULT_MAX_TOKENS = Number(process.env.AI_MAX_TOKENS || 4096);
const DEFAULT_TEMPERATURE = Number(process.env.AI_TEMPERATURE ?? aiConfig?.commonParams?.temperature ?? 0.7);
const DEFAULT_TIMEOUT_MS = Number(process.env.AI_TIMEOUT ?? aiConfig?.commonParams?.timeout ?? 45000);
const DEFAULT_TOP_P = Number(process.env.AI_TOP_P || 1);
const MAX_RETRIES = Number(process.env.AI_MAX_RETRIES || 2);
const RETRY_BASE_MS = Number(process.env.AI_RETRY_BASE_MS || 700);
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

function looksLikeTemplatePlaceholder(value) {
  return /^\s*\{\{\s*secret\.[^}]+\}\}\s*$/i.test(String(value || ""));
}

function getProviderConfig(providerId) {
  const conf = aiConfig?.models?.[providerId];
  if (!conf?.name || !conf?.apiKey) return null;
  if (looksLikeTemplatePlaceholder(conf.name) || looksLikeTemplatePlaceholder(conf.apiKey)) return null;
  return conf;
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

function makeOpenRouterError(status, body, providerId) {
  const err = new Error(`OpenRouter ${status} for provider ${providerId}: ${safeSnippet(body)}`);
  err.status = status;
  err.providerId = providerId;
  err.bodySnippet = safeSnippet(body);
  err.nonRetryable = [400, 401, 403, 404].includes(Number(status));
  return err;
}

async function callOpenRouter({ providerId, model, apiKey, messages, max_tokens, temperature, top_p, headers, timeoutMs }) {
  const payload = { model, messages, max_tokens, temperature, top_p };
  const reqHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    ...(aiConfig?.headers || {}),
    ...(headers || {}),
  };
  const effectiveTimeoutMs = Number(timeoutMs || DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), effectiveTimeoutMs);
  try {
    const res = await fetch(ENDPOINT, { method: "POST", headers: reqHeaders, body: JSON.stringify(payload), signal: controller.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw makeOpenRouterError(res.status, text, providerId);
    }
    const json = await res.json();
    return json?.choices?.[0]?.message?.content || "";
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
  timeoutMs,
  maxRetries,
  retryBaseMs,
} = {}) {
  const routeKey = resolveRouteKey(routeName);
  const chain = getProviderChainForRoute(routeKey);
  const effectiveMaxRetries = Number.isFinite(Number(maxRetries)) ? Number(maxRetries) : MAX_RETRIES;
  const effectiveRetryBaseMs = Number.isFinite(Number(retryBaseMs)) ? Number(retryBaseMs) : RETRY_BASE_MS;
  let lastErr;
  const attempted = [];

  for (const providerId of chain) {
    const provider = getProviderConfig(providerId);
    if (!provider) {
      attempted.push({ providerId, status: "misconfigured" });
      logError("ai.provider.misconfigured", { routeName, routeKey, providerId, modelEnvNames: aiConfig?.models?.[providerId]?.modelEnvNames, keyEnvNames: aiConfig?.models?.[providerId]?.keyEnvNames });
      continue;
    }
    try { safeRouteLog({ routeName, routeKey, provider: providerId, model: provider.name }); } catch {}
    for (let attempt = 0; attempt <= effectiveMaxRetries; attempt++) {
      try {
        const content = await callOpenRouter({ providerId, model: provider.name, apiKey: provider.apiKey, messages, max_tokens, temperature, top_p, headers, timeoutMs });
        __record(sessionId, routeName, providerId, provider.name);
        __lastSuccessProvider.set(routeKey, providerId);
        __maybePrintSummary(sessionId, routeName);
        return content;
      } catch (err) {
        lastErr = err;
        attempted.push({ providerId, model: provider.name, attempt: attempt + 1, status: err?.status || err?.code || "failed", message: safeSnippet(err?.message || String(err), 500) });
        const retryable = !err?.nonRetryable && attempt < effectiveMaxRetries;
        const wait = effectiveRetryBaseMs * Math.pow(2, attempt);
        logError("ai.request.retry", { routeName, routeKey, provider: providerId, attempt: attempt + 1, wait: retryable ? wait : 0, retryable, status: err?.status, message: safeSnippet(err?.message || String(err), 500) });
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
      const modelValue = conf.name;
      const keyValue = conf.apiKey;
      return {
        providerId,
        model: modelValue || undefined,
        modelEnv: Array.isArray(conf.modelEnvNames) ? conf.modelEnvNames.join("|") : undefined,
        apiKeyEnv: Array.isArray(conf.keyEnvNames) ? conf.keyEnvNames.join("|") : undefined,
        hasModel: Boolean(modelValue),
        hasApiKey: Boolean(keyValue),
        configured: Boolean(getProviderConfig(providerId)),
        unresolvedTemplate: looksLikeTemplatePlaceholder(modelValue) || looksLikeTemplatePlaceholder(keyValue),
      };
    }),
  };
}

export default { resilientRequest, getProviderDiagnosticsForRoute };
