// ============================================================
// 🧠 services/shared/utils/ai-service.js
// Resilient AI requester (OpenRouter) — ai-config–driven
// ============================================================
//
// - Uses ./ai-config.js for ALL routing & provider selection
// - Dynamic fallback for chunk routes like "scriptMain-1"
// - Per-call logging: info("ai.route.model", { routeName, provider, model })
// - End-of-session console summary ("🧠 Script Generator Summary")
// - Provider failback chain as defined in ai-config.routeModels[routeKey]
// - Warm cache: remembers last successful provider per routeKey
//
// Env usage:
//   OPENROUTER_API_BASE
//   AI_MAX_TOKENS, AI_TEMPERATURE, AI_TOP_P
//   AI_MAX_RETRIES, AI_RETRY_BASE_MS, AI_TIMEOUT
// ============================================================

import aiConfig from "./ai-config.js";
import { safeRouteLog } from "../../../logger.js";
import { info, error as logError } from "../../../logger.js";

// ---------------------------------------------
// 🔧 Config
// ---------------------------------------------
const OPENROUTER_BASE =
  process.env.OPENROUTER_API_BASE || "https://openrouter.ai/api/v1";
const ENDPOINT = `${OPENROUTER_BASE}/chat/completions`;

const DEFAULT_MAX_TOKENS = Number(process.env.AI_MAX_TOKENS || 4096);

const DEFAULT_TEMPERATURE = Number(
  process.env.AI_TEMPERATURE ??
    aiConfig?.commonParams?.temperature ??
    0.7
);

const DEFAULT_TIMEOUT_MS = Number(
  process.env.AI_TIMEOUT ??
    aiConfig?.commonParams?.timeout ??
    45000
);

const DEFAULT_TOP_P = Number(process.env.AI_TOP_P || 1);

const MAX_RETRIES = Number(process.env.AI_MAX_RETRIES || 2);
const RETRY_BASE_MS = Number(process.env.AI_RETRY_BASE_MS || 700);
const MAX_ERROR_BODY_CHARS = 700;

function safeBodySnippet(value) {
  return String(value || "")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/=:-]+/gi, "Bearer [masked]")
    .replace(/sk-or-[A-Za-z0-9._~+\/=:-]+/gi, "[masked-openrouter-key]")
    .slice(0, MAX_ERROR_BODY_CHARS);
}

export class AIProviderRequestError extends Error {
  constructor(message, { status = null, bodySnippet = "", providerId = "", model = "" } = {}) {
    super(message);
    this.name = "AIProviderRequestError";
    this.status = status;
    this.bodySnippet = safeBodySnippet(bodySnippet);
    this.providerId = providerId;
    this.model = model;
  }
}

// ---------------------------------------------
// 🧠 Session summary aggregation
// ---------------------------------------------
const __aiRouteCallsBySession = new Map();

function __sid(sessionIdLike) {
  if (!sessionIdLike) return "unknown";
  if (typeof sessionIdLike === "object") {
    return sessionIdLike.sessionId || "unknown";
  }
  return String(sessionIdLike);
}

function __record(sessionId, routeName, provider, model) {
  const sid = __sid(sessionId);
  if (!__aiRouteCallsBySession.has(sid)) {
    __aiRouteCallsBySession.set(sid, []);
  }
  __aiRouteCallsBySession.get(sid).push({ routeName, provider, model });
}

function __maybePrintSummary(sessionId, routeName) {
  const isEnd =
    routeName === "scriptOutro" ||
    routeName === "generateComposedEpisode";

  if (!isEnd) return;

  const sid = __sid(sessionId);
  const calls = __aiRouteCallsBySession.get(sid) || [];
  if (!calls.length) return;

  const header = `🧠 Script Generator Summary — ${sid}`;
  const sep = "────────────────────────────────────────────";
  const lines = calls.map(
    ({ routeName, provider }) => `${routeName.padEnd(18)}→ ${provider}`
  );

  info([header, sep, ...lines, sep, `Total Calls: ${calls.length}`].join("\n"));
  __aiRouteCallsBySession.delete(sid);
}

// ---------------------------------------------
// ⚡ Warm cache: last successful provider per routeKey
// ---------------------------------------------
const __lastSuccessProvider = new Map();

// ---------------------------------------------
// 🧭 Resolve routeKey and provider chain from ai-config
// ---------------------------------------------
function resolveRouteKey(routeName) {
  if (aiConfig.routeModels[routeName]) return routeName;

  if (routeName && routeName.startsWith("scriptMain-")) {
    return "scriptMain";
  }

  return routeName;
}

export function getProviderChainForRoute(routeKey) {
  const chain = aiConfig?.routeModels?.[routeKey];

  if (!Array.isArray(chain) || chain.length === 0) {
    throw new Error(`No model route defined for: ${routeKey}`);
  }

  const cached = __lastSuccessProvider.get(routeKey);
  if (cached && chain.includes(cached)) {
    return [cached, ...chain.filter((provider) => provider !== cached)];
  }

  return chain;
}

function configured(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function getProviderConfig(providerId) {
  const conf = aiConfig?.models?.[providerId];
  if (!conf || !configured(conf.name) || !configured(conf.apiKey)) return null;
  return conf;
}

export function getProviderDiagnosticsForRoute(routeName) {
  const routeKey = resolveRouteKey(routeName);
  const chain = aiConfig?.routeModels?.[routeKey] || [];
  return {
    routeName,
    routeKey,
    endpoint: ENDPOINT,
    configuredProviders: chain.map((providerId) => {
      const conf = aiConfig?.models?.[providerId] || {};
      const hasModel = configured(conf.name);
      const hasApiKey = configured(conf.apiKey);
      return {
        providerId,
        modelEnv: conf.modelEnv || `OPENROUTER_${String(providerId).toUpperCase()}`,
        apiKeyEnv: conf.apiKeyEnv || `OPENROUTER_API_KEY_${String(providerId).toUpperCase()}`,
        hasModel,
        hasApiKey,
        configured: hasModel && hasApiKey,
        model: hasModel ? conf.name : "",
      };
    }),
  };
}

export class AIProviderConfigurationError extends Error {
  constructor(routeName, diagnostics) {
    const missing = diagnostics.configuredProviders
      .filter((provider) => !provider.configured)
      .map((provider) => {
        const parts = [];
        if (!provider.hasModel) parts.push(provider.modelEnv);
        if (!provider.hasApiKey) parts.push(provider.apiKeyEnv);
        return `${provider.providerId}: missing ${parts.join(" + ")}`;
      })
      .join("; ");
    super(`No configured AI providers for route ${diagnostics.routeKey}. ${missing || "Provider chain is empty."}`);
    this.name = "AIProviderConfigurationError";
    this.routeName = routeName;
    this.diagnostics = diagnostics;
  }
}

// ---------------------------------------------
// 🌐 OpenRouter transport
// ---------------------------------------------
async function callOpenRouter({
  providerId,
  model,
  apiKey,
  messages,
  max_tokens,
  temperature,
  top_p,
  headers,
  timeoutMs,
}) {
  const payload = {
    model,
    messages,
    max_tokens,
    temperature,
    top_p,
  };

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
    if (typeof globalThis.fetch !== "function") {
      throw new Error("Global fetch is unavailable; Node.js >=20 is required for AI requests");
    }

    const res = await globalThis.fetch(ENDPOINT, {
      method: "POST",
      headers: reqHeaders,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const snippet = safeBodySnippet(text);
      throw new AIProviderRequestError(
        `OpenRouter ${res.status} for provider ${providerId}: ${snippet || "no response body"}`,
        { status: res.status, bodySnippet: snippet, providerId, model }
      );
    }

    const json = await res.json();
    return json?.choices?.[0]?.message?.content || "";
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new AIProviderRequestError(
        `OpenRouter request timed out after ${effectiveTimeoutMs}ms for provider ${providerId}`,
        { status: "timeout", providerId, model }
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------
// ⏱️ Backoff helper
// ---------------------------------------------
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------
// 🔁 Public API: resilientRequest
// ---------------------------------------------
export async function resilientRequest(
  routeName,
  {
    sessionId,
    section,
    messages,
    max_tokens = DEFAULT_MAX_TOKENS,
    temperature = DEFAULT_TEMPERATURE,
    top_p = DEFAULT_TOP_P,
    headers,
    timeoutMs,
    maxRetries = MAX_RETRIES,
  } = {}
) {
  const routeKey = resolveRouteKey(routeName);
  const chain = getProviderChainForRoute(routeKey);

  let lastErr;
  let configuredProviderCount = 0;
  const diagnostics = getProviderDiagnosticsForRoute(routeName);

  for (const providerId of chain) {
    const provider = getProviderConfig(providerId);

    if (!provider) {
      const providerDiagnostics = diagnostics.configuredProviders.find((item) => item.providerId === providerId);
      logError("ai.provider.misconfigured", {
        routeName,
        routeKey,
        providerId,
        modelEnv: providerDiagnostics?.modelEnv,
        apiKeyEnv: providerDiagnostics?.apiKeyEnv,
        hasModel: Boolean(providerDiagnostics?.hasModel),
        hasApiKey: Boolean(providerDiagnostics?.hasApiKey),
      });
      continue;
    }

    configuredProviderCount += 1;

    try {
      safeRouteLog({
        routeName,
        routeKey,
        provider: providerId,
        model: provider.name,
      });
    } catch {}

    const effectiveMaxRetries = Math.max(0, Number(maxRetries));

    for (let attempt = 0; attempt <= effectiveMaxRetries; attempt++) {
      try {
        const content = await callOpenRouter({
          providerId,
          model: provider.name,
          apiKey: provider.apiKey,
          messages,
          max_tokens,
          temperature,
          top_p,
          headers,
          timeoutMs,
        });

        try {
          __record(sessionId, routeName, providerId, provider.name);
        } catch {}

        __lastSuccessProvider.set(routeKey, providerId);

        try {
          __maybePrintSummary(sessionId, routeName);
        } catch {}

        return content;
      } catch (err) {
        lastErr = err;
        const wait = RETRY_BASE_MS * Math.pow(2, attempt);

        logError("ai.request.retry", {
          routeName,
          routeKey,
          provider: providerId,
          attempt: attempt + 1,
          wait,
          message: err?.message,
        });

        if (attempt < effectiveMaxRetries) {
          await sleep(wait);
        }
      }
    }
  }

  try {
    __maybePrintSummary(sessionId, routeName);
  } catch {}

  if (configuredProviderCount === 0) {
    throw new AIProviderConfigurationError(routeName, diagnostics);
  }

  throw lastErr || new Error(`All providers failed for route: ${routeKey}`);
}

export default { resilientRequest };
