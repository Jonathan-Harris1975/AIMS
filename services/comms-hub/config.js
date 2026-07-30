import { CommsHubError } from "./errors.js";

export const COMMS_HUB_FORM_ROUTES = Object.freeze({
  "260281179574362": Object.freeze({
    key: "contact",
    workflow: "contact_intake",
    subject: "Contact form submission",
  }),
  "262063136008044": Object.freeze({
    key: "case_study",
    workflow: "case_study_intake",
    subject: "Case study submission",
  }),
  "262097861889073": Object.freeze({
    key: "podcast_enquiry",
    workflow: "podcast_enquiry_intake",
    subject: "Podcast enquiry",
  }),
});

const REQUIRED_WHEN_ENABLED = Object.freeze([
  "D1_UUID",
  "D1_API_KEY",
  "JOTFORM_API_KEY",
  "R2_ENDPOINT",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_COMMS_HUB",
  "R2_PUBLIC_BASE_URL_COMMS_HUB",
]);

function normalise(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function isPlaceholder(value) {
  return /^\{\{\s*secret\.[^}]+\}\}$/i.test(normalise(value));
}

export function usableEnvValue(value) {
  const text = normalise(value);
  return text && !isPlaceholder(text) ? text : "";
}

function booleanValue(value, fallback = false) {
  const text = normalise(value).toLowerCase();
  if (!text) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(text)) return true;
  if (["0", "false", "no", "n", "off"].includes(text)) return false;
  return fallback;
}

function positiveInteger(value, fallback, name, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const text = normalise(value);
  if (!text) return fallback;
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new CommsHubError(503, "comms_hub_configuration_invalid", `${name} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

function normaliseBaseUrl(value, fallback) {
  const text = normalise(value) || fallback;
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new CommsHubError(503, "comms_hub_configuration_invalid", `Invalid URL configured: ${text}`);
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new CommsHubError(503, "comms_hub_configuration_invalid", `Only HTTP(S) URLs are supported: ${text}`);
  }
  return parsed.toString().replace(/\/+$/, "");
}

export function extractAccountIdFromR2Endpoint(value) {
  const text = usableEnvValue(value);
  if (!text) return "";
  try {
    const hostname = new URL(text).hostname.toLowerCase();
    const match = hostname.match(/^([a-f0-9]{32})\.r2\.cloudflarestorage\.com$/i);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

export function getCommsHubMissingEnv(env = process.env) {
  if (!booleanValue(env.COMMS_HUB_ENABLED, false)) return [];
  return REQUIRED_WHEN_ENABLED.filter((name) => !usableEnvValue(env[name]));
}

export function getCommsHubReadiness(env = process.env) {
  const enabled = booleanValue(env.COMMS_HUB_ENABLED, false);
  const missing = getCommsHubMissingEnv(env);
  return {
    enabled,
    ready: !enabled || missing.length === 0,
    status: !enabled ? "disabled" : missing.length ? "misconfigured" : "configured",
    missing,
    forms: Object.keys(COMMS_HUB_FORM_ROUTES).length,
  };
}

export function loadCommsHubConfig(env = process.env, { requireEnabled = false } = {}) {
  const readiness = getCommsHubReadiness(env);
  if (requireEnabled && !readiness.enabled) {
    throw new CommsHubError(503, "comms_hub_disabled", "Comms Hub is disabled.", {
      publicMessage: "Comms Hub is not enabled.",
    });
  }
  if (readiness.enabled && readiness.missing.length) {
    throw new CommsHubError(
      503,
      "comms_hub_configuration_missing",
      `Missing Comms Hub environment variables: ${readiness.missing.join(", ")}.`,
      { publicMessage: "Comms Hub is not ready." }
    );
  }

  const accountId = usableEnvValue(env.CLOUDFLARE_ACCOUNT_ID)
    || usableEnvValue(env.CF_ACCOUNT_ID)
    || extractAccountIdFromR2Endpoint(env.R2_ENDPOINT);

  return Object.freeze({
    enabled: readiness.enabled,
    d1DatabaseId: usableEnvValue(env.D1_UUID),
    d1ApiToken: usableEnvValue(env.D1_API_KEY),
    cloudflareAccountId: accountId,
    cloudflareApiBaseUrl: normaliseBaseUrl(env.CLOUDFLARE_API_BASE_URL, "https://api.cloudflare.com/client/v4"),
    jotformApiKey: usableEnvValue(env.JOTFORM_API_KEY),
    jotformApiBaseUrl: normaliseBaseUrl(env.JOTFORM_API_BASE_URL, "https://api.jotform.com"),
    r2BucketAlias: "commsHub",
    r2BucketName: usableEnvValue(env.R2_BUCKET_COMMS_HUB) || "comms-hub",
    maxWebhookBytes: positiveInteger(env.COMMS_HUB_MAX_WEBHOOK_BYTES, 1_048_576, "COMMS_HUB_MAX_WEBHOOK_BYTES", { max: 10_485_760 }),
    jotformTimeoutMs: positiveInteger(env.COMMS_HUB_JOTFORM_TIMEOUT_MS, 10_000, "COMMS_HUB_JOTFORM_TIMEOUT_MS", { min: 1_000, max: 25_000 }),
    d1TimeoutMs: positiveInteger(env.COMMS_HUB_D1_TIMEOUT_MS, 15_000, "COMMS_HUB_D1_TIMEOUT_MS", { min: 1_000, max: 30_000 }),
    providerRetryAttempts: positiveInteger(env.COMMS_HUB_PROVIDER_RETRY_ATTEMPTS, 4, "COMMS_HUB_PROVIDER_RETRY_ATTEMPTS", { max: 8 }),
    providerRetryBaseMs: positiveInteger(env.COMMS_HUB_PROVIDER_RETRY_BASE_MS, 500, "COMMS_HUB_PROVIDER_RETRY_BASE_MS", { min: 100, max: 10_000 }),
    providerRetryMaxMs: positiveInteger(env.COMMS_HUB_PROVIDER_RETRY_MAX_MS, 8_000, "COMMS_HUB_PROVIDER_RETRY_MAX_MS", { min: 500, max: 30_000 }),
    archiveWorkerEnabled: booleanValue(env.COMMS_HUB_ARCHIVE_WORKER_ENABLED, true),
    archivePollMs: positiveInteger(env.COMMS_HUB_ARCHIVE_POLL_MS, 60_000, "COMMS_HUB_ARCHIVE_POLL_MS", { min: 5_000, max: 3_600_000 }),
    archiveBatchSize: positiveInteger(env.COMMS_HUB_ARCHIVE_BATCH_SIZE, 10, "COMMS_HUB_ARCHIVE_BATCH_SIZE", { max: 100 }),
    archiveLeaseMs: positiveInteger(env.COMMS_HUB_ARCHIVE_LEASE_MS, 120_000, "COMMS_HUB_ARCHIVE_LEASE_MS", { min: 30_000, max: 900_000 }),
    archiveMaxAttempts: positiveInteger(env.COMMS_HUB_ARCHIVE_MAX_ATTEMPTS, 10, "COMMS_HUB_ARCHIVE_MAX_ATTEMPTS", { max: 50 }),
  });
}

export default loadCommsHubConfig;
