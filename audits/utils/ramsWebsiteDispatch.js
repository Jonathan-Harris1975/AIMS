import { info, warn } from "../../logger.js";
import { isRetryableDispatchError } from "./ramsWebsiteDispatchRetry.js";

const DEFAULT_RAMS_BASE_URL = "https://mod.jonathan-harris.online";

function clean(value) {
  return String(value || "").trim();
}

function boolEnv(name, fallback) {
  const raw = clean(process.env[name]).toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getRamsWebsiteDispatchConfig() {
  const baseUrl = clean(process.env.RAMS_BASE_URL || process.env.RMS_BASE_URL || DEFAULT_RAMS_BASE_URL).replace(/\/+$/, "");
  const apiKey = clean(process.env.RAMS_API_KEY || process.env.RMS_API_KEY);
  return {
    enabled: boolEnv("WEBSITE_AUDIT_TRIGGER_RAMS", true),
    baseUrl,
    apiKey,
    timeoutMs: Math.max(1000, Number(process.env.RAMS_DISPATCH_TIMEOUT_MS || 15000)),
    maxAttempts: Math.max(1, Math.min(5, Number(process.env.RAMS_DISPATCH_MAX_ATTEMPTS || 3))),
    waitForCompletion: boolEnv("RAMS_WAIT_FOR_COMPLETION", true),
    completionPollIntervalMs: Math.max(5000, Number(process.env.RAMS_COMPLETION_POLL_INTERVAL_MS || 15000)),
    completionTimeoutMs: Math.max(60000, Number(process.env.RAMS_COMPLETION_TIMEOUT_MS || 8 * 60 * 60 * 1000)),
  };
}

function validateAuditJsonKey(key) {
  const value = clean(key).replace(/^\/+/, "");
  if (!/^audits\/website\/\d{4}-\d{2}\/[A-Za-z0-9._-]+\/website-audit\.json$/.test(value)) {
    throw new Error(`RAMS website dispatch requires a final website audit JSON key; received ${value || "<empty>"}`);
  }
  return value;
}

async function postOnce({ config, sessionId, auditJsonKey }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}/rebuild/website/run`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
        "x-idempotency-key": `website-audit:${sessionId}`,
      },
      body: JSON.stringify({
        audit_json_key: auditJsonKey,
        audit_session_id: sessionId,
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text.slice(0, 1000) }; }
    if (response.status !== 202) {
      const error = new Error(`RAMS website rebuild dispatch returned HTTP ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}


async function getRamsRunReport({ config, runId }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}/reports/website/${encodeURIComponent(runId)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${config.apiKey}` },
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text.slice(0, 1000) }; }
    if (response.status === 200) return { state: "completed", payload };
    if (response.status === 202) return { state: "pending", payload };
    const error = new Error(`RAMS website run status returned HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForRamsRunCompletion({ config, runId, sessionId, auditJsonKey }) {
  const deadline = Date.now() + config.completionTimeoutMs;
  while (Date.now() < deadline) {
    const current = await getRamsRunReport({ config, runId });
    if (current.state === "completed") {
      if (current.payload?.error) {
        const error = new Error(`RAMS website remediation completed with an error: ${current.payload.error}`);
        error.payload = current.payload;
        throw error;
      }
      info("audit.website.rams.completed", {
        sessionId,
        auditJsonKey,
        runId,
        issuesApplied: current.payload?.issuesApplied ?? null,
        issuesManualReview: current.payload?.issuesManualReview ?? null,
      });
      return {
        ok: true,
        status: "completed",
        runId,
        finishedAt: current.payload?.finishedAt || null,
        issuesTotal: current.payload?.issuesTotal ?? null,
        issuesApplied: current.payload?.issuesApplied ?? null,
        issuesReverted: current.payload?.issuesReverted ?? null,
        issuesSkipped: current.payload?.issuesSkipped ?? null,
        issuesManualReview: current.payload?.issuesManualReview ?? null,
        branch: current.payload?.branch || null,
      };
    }
    await sleep(config.completionPollIntervalMs);
  }
  throw new Error(`RAMS website remediation ${runId} exceeded ${config.completionTimeoutMs}ms completion timeout`);
}

export function assertRamsWebsiteDispatchConfigured() {
  const config = getRamsWebsiteDispatchConfig();
  if (!config.enabled) return config;
  if (!config.apiKey) {
    throw new Error("WEBSITE_AUDIT_TRIGGER_RAMS is enabled but RAMS_API_KEY or RMS_API_KEY is not configured in AIMS");
  }
  if (!config.baseUrl) {
    throw new Error("WEBSITE_AUDIT_TRIGGER_RAMS is enabled but RAMS_BASE_URL is empty");
  }
  return config;
}

export async function dispatchWebsiteAuditToRams({ sessionId, auditJsonKey }) {
  const config = assertRamsWebsiteDispatchConfigured();
  if (!config.enabled) {
    return { ok: true, status: "disabled", enabled: false };
  }
  const finalKey = validateAuditJsonKey(auditJsonKey);
  let lastError;
  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    try {
      const payload = await postOnce({ config, sessionId, auditJsonKey: finalKey });
      info("audit.website.rams.dispatched", { sessionId, auditJsonKey: finalKey, attempt, runId: payload.runId || null });
      if (!config.waitForCompletion) {
        return { ok: true, status: "accepted", enabled: true, attempt, ...payload };
      }
      if (!payload.runId) throw new Error("RAMS website rebuild dispatch omitted runId");
      const completion = await waitForRamsRunCompletion({
        config,
        runId: payload.runId,
        sessionId,
        auditJsonKey: finalKey,
      });
      return { ok: true, enabled: true, attempt, accepted: true, ...payload, completion, status: completion.status };
    } catch (err) {
      lastError = err;
      const retryable = isRetryableDispatchError(err);
      warn("audit.website.rams.dispatch_retry", {
        sessionId,
        auditJsonKey: finalKey,
        attempt,
        maxAttempts: config.maxAttempts,
        status: err?.status || null,
        retryable,
        message: err?.message || String(err),
      });
      if (!retryable) break;
      if (attempt < config.maxAttempts) await sleep(500 * attempt);
    }
  }
  throw lastError || new Error("RAMS website rebuild dispatch failed");
}

export const __ramsWebsiteDispatchTestHooks = { validateAuditJsonKey, boolEnv, getRamsRunReport, waitForRamsRunCompletion, isRetryableDispatchError };

export default { assertRamsWebsiteDispatchConfigured, dispatchWebsiteAuditToRams, getRamsWebsiteDispatchConfig };
