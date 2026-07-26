import { info, warn } from "../../logger.js";

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

export async function dispatchWebsiteAuditToRams({ sessionId, auditJsonKey }) {
  const config = getRamsWebsiteDispatchConfig();
  if (!config.enabled) {
    return { ok: true, status: "disabled", enabled: false };
  }
  if (!config.apiKey) {
    throw new Error("WEBSITE_AUDIT_TRIGGER_RAMS is enabled but RAMS_API_KEY or RMS_API_KEY is not configured in AIMS");
  }
  if (!config.baseUrl) {
    throw new Error("WEBSITE_AUDIT_TRIGGER_RAMS is enabled but RAMS_BASE_URL is empty");
  }
  const finalKey = validateAuditJsonKey(auditJsonKey);
  let lastError;
  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    try {
      const payload = await postOnce({ config, sessionId, auditJsonKey: finalKey });
      info("audit.website.rams.dispatched", { sessionId, auditJsonKey: finalKey, attempt, runId: payload.runId || null });
      return { ok: true, status: "accepted", enabled: true, attempt, ...payload };
    } catch (err) {
      lastError = err;
      warn("audit.website.rams.dispatch_retry", {
        sessionId,
        auditJsonKey: finalKey,
        attempt,
        maxAttempts: config.maxAttempts,
        status: err?.status || null,
        message: err?.message || String(err),
      });
      if (attempt < config.maxAttempts) await sleep(500 * attempt);
    }
  }
  throw lastError || new Error("RAMS website rebuild dispatch failed");
}

export const __ramsWebsiteDispatchTestHooks = { validateAuditJsonKey, boolEnv };

export default { dispatchWebsiteAuditToRams, getRamsWebsiteDispatchConfig };
