// ============================================================
// services/shared/utils/headroom.js
// Fail-open Headroom compression for eligible OpenRouter chat calls.
// ============================================================

import { info, warn } from "../../../logger.js";

const DEFAULT_ROUTES = Object.freeze([
  "compose",
  "scriptMain",
  "scriptMainSynthesis",
  "editorialPass",
  "editAndFormat",
  "rssRewrite",
  "blogWeekly",
  "blogSocial",
  "onBrandAudit",
  "auditForensic",
  "zernioDaily",
  "zernioMiniSeriesResearch",
  "zernioMiniSeriesTheme",
  "zernioMiniSeriesPost",
  "zernioEbook",
  "blotatoNewsShort",
  "newsletterCompose",
  "newsletterFactCheck",
  "newsletterVoiceReview",
  "newsletterAudienceReview",
  "newsletterCouncilChair",
]);

const HARD_BYPASS_ROUTES = new Set(["artworkVisualQa", "blotatoVisualQa", "artworkImage"]);
let warnedMissingBaseUrl = false;

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalised = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "y"].includes(normalised)) return true;
  if (["0", "false", "no", "off", "n"].includes(normalised)) return false;
  return fallback;
}

function finiteNumber(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return n;
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getEligibleRoutes() {
  const configured = parseCsv(process.env.HEADROOM_ROUTES);
  return new Set(configured.length ? configured : DEFAULT_ROUTES);
}

function getCompressEndpoint() {
  const base = String(process.env.HEADROOM_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  return /\/v1$/i.test(base) ? `${base}/compress` : `${base}/v1/compress`;
}

function getBearerToken() {
  return String(process.env.HEADROOM_API_KEY || process.env.HEADROOM_PROXY_TOKEN || "").trim();
}

function textCharacterCount(messages = []) {
  let total = 0;
  for (const message of messages) {
    const content = message?.content;
    if (typeof content === "string") total += content.length;
    else if (Array.isArray(content)) {
      for (const part of content) {
        if (typeof part === "string") total += part.length;
        else if (part?.type === "text" && typeof part.text === "string") total += part.text.length;
      }
    }
  }
  return total;
}

function isTextOnly(messages = []) {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  return messages.every((message) => {
    if (!message || typeof message !== "object" || typeof message.role !== "string") return false;
    if (typeof message.content === "string") return true;
    if (!Array.isArray(message.content)) return false;
    return message.content.every(
      (part) => typeof part === "string" || (part && part.type === "text" && typeof part.text === "string")
    );
  });
}

function systemMessagesPreserved(original, candidate) {
  for (let i = 0; i < original.length; i += 1) {
    if (original[i]?.role !== "system") continue;
    if (JSON.stringify(original[i]) !== JSON.stringify(candidate[i])) return false;
  }
  return true;
}

function shapePreserved(original, candidate) {
  if (!Array.isArray(candidate) || candidate.length !== original.length) return false;
  for (let i = 0; i < original.length; i += 1) {
    if (!candidate[i] || typeof candidate[i] !== "object") return false;
    if (candidate[i].role !== original[i].role) return false;

    const originalMetadata = { ...original[i] };
    const candidateMetadata = { ...candidate[i] };
    delete originalMetadata.content;
    delete candidateMetadata.content;
    if (JSON.stringify(originalMetadata) !== JSON.stringify(candidateMetadata)) return false;
  }
  return systemMessagesPreserved(original, candidate);
}

function makeExternalAbortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const err = new Error("AI request aborted");
  err.name = "AbortError";
  err.code = "AI_REQUEST_ABORTED";
  return err;
}

async function fetchWithTimeout(url, options, { timeoutMs, signal } = {}) {
  if (signal?.aborted) throw makeExternalAbortError(signal);

  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener?.("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (signal?.aborted) throw makeExternalAbortError(signal);
    if (timedOut || error?.name === "AbortError") {
      const timeoutError = new Error(`Headroom compression timed out after ${timeoutMs}ms`);
      timeoutError.code = "HEADROOM_TIMEOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", onAbort);
  }
}

function skip(reason, messages, extra = {}) {
  return {
    messages,
    compressed: false,
    skipped: true,
    reason,
    tokensBefore: null,
    tokensAfter: null,
    tokensSaved: 0,
    compressionRatio: 1,
    ...extra,
  };
}

export async function compressForOpenRouter({ routeName, routeKey, model, messages, signal } = {}) {
  const original = Array.isArray(messages) ? messages : [];
  if (!parseBoolean(process.env.HEADROOM_ENABLED, false)) return skip("disabled", original);
  if (signal?.aborted) throw makeExternalAbortError(signal);

  const effectiveRoute = routeKey || routeName;
  if (HARD_BYPASS_ROUTES.has(effectiveRoute) || HARD_BYPASS_ROUTES.has(routeName)) {
    return skip("hard-bypass-route", original);
  }
  const eligibleRoutes = getEligibleRoutes();
  if (!eligibleRoutes.has(effectiveRoute) && !eligibleRoutes.has(routeName)) {
    return skip("route-not-enabled", original);
  }
  if (!isTextOnly(original)) return skip("non-text-or-multimodal", original);

  const minChars = Math.floor(finiteNumber(process.env.HEADROOM_MIN_INPUT_CHARS, 2000, { min: 1 }));
  const inputChars = textCharacterCount(original);
  if (inputChars < minChars) return skip("below-minimum-input", original, { inputChars });

  const endpoint = getCompressEndpoint();
  if (!endpoint) {
    if (!warnedMissingBaseUrl) {
      warnedMissingBaseUrl = true;
      warn("ai.headroom.unconfigured", { reason: "HEADROOM_ENABLED=true but HEADROOM_BASE_URL is empty" });
    }
    return skip("missing-base-url", original, { inputChars });
  }

  const timeoutMs = Math.floor(finiteNumber(process.env.HEADROOM_TIMEOUT_MS, 5000, { min: 100 }));
  const targetRatio = finiteNumber(process.env.HEADROOM_TARGET_RATIO, 0.7, { min: 0.05, max: 1 });
  const protectRecent = Math.floor(finiteNumber(process.env.HEADROOM_PROTECT_RECENT, 0, { min: 0 }));
  const token = getBearerToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const body = {
    messages: original,
    model: String(model || "").trim(),
    config: {
      compress_user_messages: parseBoolean(process.env.HEADROOM_COMPRESS_USER_MESSAGES, true),
      target_ratio: targetRatio,
      protect_recent: protectRecent,
    },
  };

  if (!body.model) return skip("missing-model", original, { inputChars });

  const startedAt = Date.now();
  try {
    const response = await fetchWithTimeout(
      endpoint,
      { method: "POST", headers, body: JSON.stringify(body) },
      { timeoutMs, signal }
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      warn("ai.headroom.fail_open", {
        routeName,
        routeKey: effectiveRoute,
        model,
        status: response.status,
        detail: String(text || "").replace(/\s+/g, " ").slice(0, 300),
      });
      return skip("http-error", original, { inputChars, durationMs: Date.now() - startedAt });
    }

    const result = await response.json();
    if (result?.compression_skipped) {
      return skip(result?.skip_reason || "headroom-skipped", original, {
        inputChars,
        durationMs: Date.now() - startedAt,
      });
    }

    const candidate = result?.messages;
    const tokensBefore = Number(result?.tokens_before);
    const tokensAfter = Number(result?.tokens_after);
    const tokensSaved = Number(result?.tokens_saved);
    const compressionRatio = Number(result?.compression_ratio);

    if (!shapePreserved(original, candidate)) {
      warn("ai.headroom.rejected", { routeName, routeKey: effectiveRoute, model, reason: "message-shape-or-system-changed" });
      return skip("unsafe-message-change", original, { inputChars, durationMs: Date.now() - startedAt });
    }

    if (!Number.isFinite(tokensBefore) || !Number.isFinite(tokensAfter) || !Number.isFinite(tokensSaved)) {
      warn("ai.headroom.rejected", { routeName, routeKey: effectiveRoute, model, reason: "missing-token-metrics" });
      return skip("missing-token-metrics", original, { inputChars, durationMs: Date.now() - startedAt });
    }

    if (tokensSaved <= 0 || tokensAfter >= tokensBefore) {
      return skip("no-token-saving", original, {
        inputChars,
        tokensBefore,
        tokensAfter,
        tokensSaved: 0,
        compressionRatio: Number.isFinite(compressionRatio) ? compressionRatio : 1,
        durationMs: Date.now() - startedAt,
      });
    }

    const outcome = {
      messages: candidate,
      compressed: true,
      skipped: false,
      reason: null,
      inputChars,
      tokensBefore,
      tokensAfter,
      tokensSaved,
      compressionRatio: Number.isFinite(compressionRatio) ? compressionRatio : tokensAfter / tokensBefore,
      transformsApplied: Array.isArray(result?.transforms_applied) ? result.transforms_applied : [],
      durationMs: Date.now() - startedAt,
    };

    if (parseBoolean(process.env.HEADROOM_LOG_SAVINGS, true)) {
      info("ai.headroom.compressed", {
        routeName,
        routeKey: effectiveRoute,
        model,
        tokensBefore: outcome.tokensBefore,
        tokensAfter: outcome.tokensAfter,
        tokensSaved: outcome.tokensSaved,
        compressionRatio: outcome.compressionRatio,
        durationMs: outcome.durationMs,
      });
    }

    return outcome;
  } catch (error) {
    if (signal?.aborted) throw makeExternalAbortError(signal);
    warn("ai.headroom.fail_open", {
      routeName,
      routeKey: effectiveRoute,
      model,
      code: error?.code,
      error: error?.message || String(error),
    });
    return skip(error?.code === "HEADROOM_TIMEOUT" ? "timeout" : "compression-error", original, {
      inputChars,
      durationMs: Date.now() - startedAt,
    });
  }
}

export const __headroomTestHooks = {
  DEFAULT_ROUTES,
  HARD_BYPASS_ROUTES,
  getCompressEndpoint,
  isTextOnly,
  shapePreserved,
  textCharacterCount,
};

export default { compressForOpenRouter };
