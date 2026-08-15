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

export const ZERNIO_CHANNEL_FAMILIES = Object.freeze({
  meta: Object.freeze({
    platforms: Object.freeze(["facebook", "instagram"]),
    apiKeyEnv: "ZERNIO_META_API_KEY",
    webhookSecretEnv: "ZERNIO_META_WEBHOOK_SECRET",
    enabledEnv: "COMMS_HUB_ZERNIO_META_ENABLED",
  }),
  video: Object.freeze({
    platforms: Object.freeze(["youtube"]),
    apiKeyEnv: "ZERNIO_VIDEO_API_KEY",
    webhookSecretEnv: "ZERNIO_VIDEO_WEBHOOK_SECRET",
    enabledEnv: "COMMS_HUB_ZERNIO_VIDEO_ENABLED",
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

export function booleanValue(value, fallback = false) {
  const text = normalise(value).toLowerCase();
  if (!text) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(text)) return true;
  if (["0", "false", "no", "n", "off"].includes(text)) return false;
  return fallback;
}


function csvValue(value) {
  return normalise(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function jsonValue(value, fallback = {}) {
  const text = normalise(value);
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    throw new CommsHubError(503, "comms_hub_configuration_invalid", "Configured JSON value is invalid.");
  }
}

function decimalValue(value, fallback, name, { min = 0, max = 1 } = {}) {
  const text = normalise(value);
  if (!text) return fallback;
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new CommsHubError(503, "comms_hub_configuration_invalid", `${name} must be a number between ${min} and ${max}.`);
  }
  return parsed;
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

function normaliseBaseUrl(value, fallback, { required = false } = {}) {
  const text = normalise(value) || fallback || "";
  if (!text) {
    if (required) throw new CommsHubError(503, "comms_hub_configuration_invalid", "A required URL is not configured.");
    return "";
  }
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

export function getZernioFamilyReadiness(family, env = process.env) {
  const definition = ZERNIO_CHANNEL_FAMILIES[family];
  if (!definition) throw new TypeError(`Unsupported Zernio credential family: ${family}`);
  const enabled = booleanValue(env[definition.enabledEnv], false);
  const missing = [];
  if (enabled) {
    for (const name of [
      definition.apiKeyEnv,
      definition.webhookSecretEnv,
      "COMMS_HUB_PUBLIC_BASE_URL",
      "COMMS_HUB_D1_PROXY_URL",
      "COMMS_HUB_D1_PROXY_TOKEN",
    ]) {
      if (!usableEnvValue(env[name])) missing.push(name);
    }
  }
  return {
    family,
    enabled,
    ready: !enabled || missing.length === 0,
    status: !enabled ? "disabled" : missing.length ? "misconfigured" : "configured",
    missing,
    platforms: [...definition.platforms],
  };
}

export function getCommsHubMissingEnv(env = process.env) {
  if (!booleanValue(env.COMMS_HUB_ENABLED, false)) return [];
  const missing = REQUIRED_WHEN_ENABLED.filter((name) => !usableEnvValue(env[name]));
  const aiEnabled = booleanValue(env.COMMS_HUB_AI_ENABLED, false);
  const backupEnabled = booleanValue(env.COMMS_HUB_BACKUP_ENABLED, false);
  for (const family of Object.keys(ZERNIO_CHANNEL_FAMILIES)) {
    missing.push(...getZernioFamilyReadiness(family, env).missing);
  }
  if (booleanValue(env.COMMS_HUB_FOLLOW_UP_WORKER_ENABLED, false) && !aiEnabled) {
    missing.push("COMMS_HUB_AI_ENABLED");
  }
  if (booleanValue(env.COMMS_HUB_BACKUP_AUTOMATIC_ENABLED, false) && !backupEnabled) {
    missing.push("COMMS_HUB_BACKUP_ENABLED");
  }
  if (aiEnabled) {
    for (const name of ["CLOUDFLARE_AI_SEARCH_API_TOKEN", "COMMS_HUB_AI_SEARCH_INSTANCES"]) {
      if (!usableEnvValue(env[name])) missing.push(name);
    }
    if (!usableEnvValue(env.CLOUDFLARE_ACCOUNT_ID) && !usableEnvValue(env.CF_ACCOUNT_ID) && !extractAccountIdFromR2Endpoint(env.R2_ENDPOINT)) {
      missing.push("CLOUDFLARE_ACCOUNT_ID");
    }
  }
  if (backupEnabled) {
    if (!usableEnvValue(env.CLOUDFLARE_ACCOUNT_ID) && !usableEnvValue(env.CF_ACCOUNT_ID) && !extractAccountIdFromR2Endpoint(env.R2_ENDPOINT)) {
      missing.push("CLOUDFLARE_ACCOUNT_ID");
    }
    const primaryBucket = usableEnvValue(env.R2_BUCKET_COMMS_HUB) || "comms-hub";
    const privateBucket = usableEnvValue(env.R2_BUCKET_COMMS_HUB_PRIVATE);
    const restoreBucket = usableEnvValue(env.R2_BUCKET_COMMS_HUB_RESTORE);
    const sourceDatabase = usableEnvValue(env.D1_UUID);
    const restoreDatabase = usableEnvValue(env.COMMS_HUB_RESTORE_DATABASE_ID);
    if (!privateBucket || privateBucket === primaryBucket) missing.push("R2_BUCKET_COMMS_HUB_PRIVATE");
    if (!restoreBucket || restoreBucket === primaryBucket || restoreBucket === privateBucket) missing.push("R2_BUCKET_COMMS_HUB_RESTORE");
    if (!restoreDatabase || restoreDatabase === sourceDatabase) missing.push("COMMS_HUB_RESTORE_DATABASE_ID");
  }
  if (booleanValue(env.COMMS_HUB_EMAIL_ENABLED, false)) {
    for (const name of ["COMMS_HUB_ONECOM_ACCOUNT_KEY", "COMMS_HUB_ONECOM_EMAIL_ADDRESS", "COMMS_HUB_ONECOM_USERNAME", "COMMS_HUB_ONECOM_IMAP_HOST", "COMMS_HUB_ONECOM_SMTP_HOST", "R2_BUCKET_COMMS_HUB_PRIVATE", "COMMS_HUB_ATTACHMENT_SCANNER_URL", "COMMS_HUB_ATTACHMENT_SCANNER_TOKEN"]) {
      if (!usableEnvValue(env[name])) missing.push(name);
    }
    if (!usableEnvValue(env.COMMS_HUB_ONECOM_PASSWORD) && !usableEnvValue(env.ONECOM_INFO_PASSWORD)) {
      missing.push("ONECOM_INFO_PASSWORD");
    }
  }
  if (booleanValue(env.COMMS_HUB_CHAT_ENABLED, false)) {
    for (const name of ["COMMS_HUB_COGINPAL_API_BASE_URL", "COMMS_HUB_COGINPAL_API_KEY", "COMMS_HUB_COGINPAL_WEBHOOK_SECRET"]) {
      if (!usableEnvValue(env[name])) missing.push(name);
    }
  }
  if (booleanValue(env.COMMS_HUB_WAKE_ENABLED, false)) {
    for (const name of ["COMMS_HUB_WAKE_REQUEST_URL", "COMMS_HUB_WAKE_REQUEST_SECRET"]) if (!usableEnvValue(env[name])) missing.push(name);
  }
  if (booleanValue(env.COMMS_HUB_RETENTION_WORKER_ENABLED, false) && !usableEnvValue(env.R2_BUCKET_COMMS_HUB_PRIVATE)) missing.push("R2_BUCKET_COMMS_HUB_PRIVATE");
  if (booleanValue(env.COMMS_HUB_CREDENTIAL_VAULT_ENABLED, false) && !usableEnvValue(env.COMMS_HUB_CREDENTIAL_MASTER_KEY)) missing.push("COMMS_HUB_CREDENTIAL_MASTER_KEY");
  if (booleanValue(env.COMMS_HUB_EMAIL_POLL_WORKER_ENABLED, false) && !booleanValue(env.COMMS_HUB_EMAIL_ENABLED, false)) missing.push("COMMS_HUB_EMAIL_ENABLED");
  if (booleanValue(env.COMMS_HUB_AUTONOMOUS_REPLIES_ENABLED, false) && !aiEnabled) missing.push("COMMS_HUB_AI_ENABLED");
  return [...new Set(missing)];
}

export function getCommsHubReadiness(env = process.env) {
  const enabled = booleanValue(env.COMMS_HUB_ENABLED, false);
  const missing = getCommsHubMissingEnv(env);
  const zernio = Object.fromEntries(
    Object.keys(ZERNIO_CHANNEL_FAMILIES).map((family) => [family, getZernioFamilyReadiness(family, env)])
  );
  return {
    enabled,
    ready: !enabled || missing.length === 0,
    status: !enabled ? "disabled" : missing.length ? "misconfigured" : "configured",
    missing,
    forms: Object.keys(COMMS_HUB_FORM_ROUTES).length,
    zernio,
    channels: {
      email: booleanValue(env.COMMS_HUB_EMAIL_ENABLED, false),
      chat: booleanValue(env.COMMS_HUB_CHAT_ENABLED, false),
    },
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
  const aiEnabled = booleanValue(env.COMMS_HUB_AI_ENABLED, false);

  const zernioFamilies = Object.fromEntries(
    Object.entries(ZERNIO_CHANNEL_FAMILIES).map(([family, definition]) => {
      const familyReadiness = readiness.zernio[family];
      return [family, Object.freeze({
        family,
        enabled: familyReadiness.enabled,
        apiKey: usableEnvValue(env[definition.apiKeyEnv]),
        webhookSecret: usableEnvValue(env[definition.webhookSecretEnv]),
        platforms: [...definition.platforms],
        webhookName: family === "meta" ? "AIMS Comms Hub Meta" : "AIMS Comms Hub Video",
      })];
    })
  );

  return Object.freeze({
    enabled: readiness.enabled,
    d1DatabaseId: usableEnvValue(env.D1_UUID),
    d1ApiToken: usableEnvValue(env.D1_API_KEY),
    d1ProxyUrl: normaliseBaseUrl(env.COMMS_HUB_D1_PROXY_URL, ""),
    d1ProxyToken: usableEnvValue(env.COMMS_HUB_D1_PROXY_TOKEN),
    cloudflareAccountId: accountId,
    cloudflareApiBaseUrl: normaliseBaseUrl(env.CLOUDFLARE_API_BASE_URL, "https://api.cloudflare.com/client/v4"),
    jotformApiKey: usableEnvValue(env.JOTFORM_API_KEY),
    jotformApiBaseUrl: normaliseBaseUrl(env.JOTFORM_API_BASE_URL, "https://api.jotform.com"),
    zernioApiBaseUrl: normaliseBaseUrl(env.ZERNIO_API_BASE_URL, "https://zernio.com/api/v1"),
    zernioFamilies: Object.freeze(zernioFamilies),
    publicBaseUrl: normaliseBaseUrl(env.COMMS_HUB_PUBLIC_BASE_URL, ""),
    r2BucketAlias: "commsHub",
    r2BucketName: usableEnvValue(env.R2_BUCKET_COMMS_HUB) || "comms-hub",
    r2PrivateBucketName: usableEnvValue(env.R2_BUCKET_COMMS_HUB_PRIVATE),
    r2RestoreBucketName: usableEnvValue(env.R2_BUCKET_COMMS_HUB_RESTORE),
    r2Endpoint: usableEnvValue(env.R2_ENDPOINT),
    r2Region: usableEnvValue(env.R2_REGION) || "auto",
    r2AccessKeyId: usableEnvValue(env.R2_ACCESS_KEY_ID),
    r2SecretAccessKey: usableEnvValue(env.R2_SECRET_ACCESS_KEY),
    aiEnabled,
    approvalsEnforced: aiEnabled ? true : booleanValue(env.COMMS_HUB_APPROVALS_ENFORCED, true),
    aiSearchApiToken: usableEnvValue(env.CLOUDFLARE_AI_SEARCH_API_TOKEN),
    aiSearchApprovedInstances: Object.freeze([...new Set(csvValue(env.COMMS_HUB_AI_SEARCH_INSTANCES))]),
    aiSearchTimeoutMs: positiveInteger(env.COMMS_HUB_AI_SEARCH_TIMEOUT_MS, 20_000, "COMMS_HUB_AI_SEARCH_TIMEOUT_MS", { min: 1_000, max: 60_000 }),
    aiMaximumEvidence: positiveInteger(env.COMMS_HUB_AI_MAX_EVIDENCE, 8, "COMMS_HUB_AI_MAX_EVIDENCE", { min: 1, max: 30 }),
    aiAutoApprovalRiskThreshold: decimalValue(env.COMMS_HUB_AI_AUTO_APPROVAL_RISK_THRESHOLD, 0.2, "COMMS_HUB_AI_AUTO_APPROVAL_RISK_THRESHOLD"),
    aiApprovalPriorityScore: positiveInteger(env.COMMS_HUB_AI_APPROVAL_PRIORITY_SCORE, 60, "COMMS_HUB_AI_APPROVAL_PRIORITY_SCORE", { min: 1, max: 100 }),
    aiComplexityPriorityScore: positiveInteger(env.COMMS_HUB_COMPLEXITY_PRIORITY_SCORE, 70, "COMMS_HUB_COMPLEXITY_PRIORITY_SCORE", { min: 1, max: 100 }),
    aiComplexityMessageCount: positiveInteger(env.COMMS_HUB_COMPLEXITY_MESSAGE_COUNT, 12, "COMMS_HUB_COMPLEXITY_MESSAGE_COUNT", { min: 2, max: 100 }),
    aiComplexityCharacterCount: positiveInteger(env.COMMS_HUB_COMPLEXITY_CHARACTER_COUNT, 12_000, "COMMS_HUB_COMPLEXITY_CHARACTER_COUNT", { min: 1000, max: 80000 }),
    aiComplexityModerationSeverity: decimalValue(env.COMMS_HUB_COMPLEXITY_MODERATION_SEVERITY, 0.55, "COMMS_HUB_COMPLEXITY_MODERATION_SEVERITY"),
    followUpWorkerEnabled: booleanValue(env.COMMS_HUB_FOLLOW_UP_WORKER_ENABLED, false),
    followUpPollMs: positiveInteger(env.COMMS_HUB_FOLLOW_UP_POLL_MS, 300_000, "COMMS_HUB_FOLLOW_UP_POLL_MS", { min: 30_000, max: 3_600_000 }),
    followUpLeaseMs: positiveInteger(env.COMMS_HUB_FOLLOW_UP_LEASE_MS, 180_000, "COMMS_HUB_FOLLOW_UP_LEASE_MS", { min: 30_000, max: 900_000 }),
    followUpBatchSize: positiveInteger(env.COMMS_HUB_FOLLOW_UP_BATCH_SIZE, 10, "COMMS_HUB_FOLLOW_UP_BATCH_SIZE", { min: 1, max: 100 }),
    followUpMaxAttempts: positiveInteger(env.COMMS_HUB_FOLLOW_UP_MAX_ATTEMPTS, 8, "COMMS_HUB_FOLLOW_UP_MAX_ATTEMPTS", { min: 1, max: 50 }),
    providerHealthWorkerEnabled: booleanValue(env.COMMS_HUB_PROVIDER_HEALTH_ENABLED, false),
    providerHealthPollMs: positiveInteger(env.COMMS_HUB_PROVIDER_HEALTH_POLL_MS, 300_000, "COMMS_HUB_PROVIDER_HEALTH_POLL_MS", { min: 30_000, max: 3_600_000 }),
    providerHealthStaleMs: positiveInteger(env.COMMS_HUB_PROVIDER_HEALTH_STALE_MS, 900_000, "COMMS_HUB_PROVIDER_HEALTH_STALE_MS", { min: 60_000, max: 86_400_000 }),
    providerHealthFailureThreshold: positiveInteger(env.COMMS_HUB_PROVIDER_HEALTH_FAILURE_THRESHOLD, 3, "COMMS_HUB_PROVIDER_HEALTH_FAILURE_THRESHOLD", { min: 1, max: 100 }),
    backupEnabled: booleanValue(env.COMMS_HUB_BACKUP_ENABLED, false),
    backupAutomaticEnabled: booleanValue(env.COMMS_HUB_BACKUP_AUTOMATIC_ENABLED, false),
    backupIntervalMs: positiveInteger(env.COMMS_HUB_BACKUP_INTERVAL_MS, 86_400_000, "COMMS_HUB_BACKUP_INTERVAL_MS", { min: 3_600_000, max: 604_800_000 }),
    backupPollMs: positiveInteger(env.COMMS_HUB_BACKUP_POLL_MS, 1_000, "COMMS_HUB_BACKUP_POLL_MS", { min: 250, max: 30_000 }),
    backupPollAttempts: positiveInteger(env.COMMS_HUB_BACKUP_POLL_ATTEMPTS, 300, "COMMS_HUB_BACKUP_POLL_ATTEMPTS", { min: 1, max: 3600 }),
    backupRequestTimeoutMs: positiveInteger(env.COMMS_HUB_BACKUP_REQUEST_TIMEOUT_MS, 60_000, "COMMS_HUB_BACKUP_REQUEST_TIMEOUT_MS", { min: 5_000, max: 300_000 }),
    restoreDatabaseId: usableEnvValue(env.COMMS_HUB_RESTORE_DATABASE_ID),
    backupObjectPrefixes: Object.freeze(csvValue(env.COMMS_HUB_BACKUP_OBJECT_PREFIXES || "attachments/,conversation-assets/")),
    backupMaxLinkedObjects: positiveInteger(env.COMMS_HUB_BACKUP_MAX_LINKED_OBJECTS, 1000, "COMMS_HUB_BACKUP_MAX_LINKED_OBJECTS", { min: 1, max: 10000 }),
    maxWebhookBytes: positiveInteger(env.COMMS_HUB_MAX_WEBHOOK_BYTES, 1_048_576, "COMMS_HUB_MAX_WEBHOOK_BYTES", { max: 10_485_760 }),
    jotformTimeoutMs: positiveInteger(env.COMMS_HUB_JOTFORM_TIMEOUT_MS, 10_000, "COMMS_HUB_JOTFORM_TIMEOUT_MS", { min: 1_000, max: 25_000 }),
    jotformSourceTimeZone: usableEnvValue(env.COMMS_HUB_JOTFORM_SOURCE_TIMEZONE) || "UTC",
    zernioTimeoutMs: positiveInteger(env.COMMS_HUB_ZERNIO_TIMEOUT_MS, 15_000, "COMMS_HUB_ZERNIO_TIMEOUT_MS", { min: 1_000, max: 30_000 }),
    zernioAckTimeoutMs: positiveInteger(env.COMMS_HUB_ZERNIO_ACK_TIMEOUT_MS, 4_000, "COMMS_HUB_ZERNIO_ACK_TIMEOUT_MS", { min: 500, max: 4_500 }),
    d1TimeoutMs: positiveInteger(env.COMMS_HUB_D1_TIMEOUT_MS, 15_000, "COMMS_HUB_D1_TIMEOUT_MS", { min: 1_000, max: 30_000 }),
    providerRetryAttempts: positiveInteger(env.COMMS_HUB_PROVIDER_RETRY_ATTEMPTS, 4, "COMMS_HUB_PROVIDER_RETRY_ATTEMPTS", { max: 8 }),
    providerRetryBaseMs: positiveInteger(env.COMMS_HUB_PROVIDER_RETRY_BASE_MS, 500, "COMMS_HUB_PROVIDER_RETRY_BASE_MS", { min: 100, max: 10_000 }),
    providerRetryMaxMs: positiveInteger(env.COMMS_HUB_PROVIDER_RETRY_MAX_MS, 8_000, "COMMS_HUB_PROVIDER_RETRY_MAX_MS", { min: 500, max: 30_000 }),
    archiveWorkerEnabled: booleanValue(env.COMMS_HUB_ARCHIVE_WORKER_ENABLED, true),
    archivePollMs: positiveInteger(env.COMMS_HUB_ARCHIVE_POLL_MS, 60_000, "COMMS_HUB_ARCHIVE_POLL_MS", { min: 5_000, max: 3_600_000 }),
    archiveBatchSize: positiveInteger(env.COMMS_HUB_ARCHIVE_BATCH_SIZE, 10, "COMMS_HUB_ARCHIVE_BATCH_SIZE", { max: 100 }),
    archiveLeaseMs: positiveInteger(env.COMMS_HUB_ARCHIVE_LEASE_MS, 120_000, "COMMS_HUB_ARCHIVE_LEASE_MS", { min: 30_000, max: 900_000 }),
    archiveMaxAttempts: positiveInteger(env.COMMS_HUB_ARCHIVE_MAX_ATTEMPTS, 10, "COMMS_HUB_ARCHIVE_MAX_ATTEMPTS", { max: 50 }),
    socialMonitorOnly: booleanValue(env.COMMS_HUB_SOCIAL_MONITOR_ONLY, true),
    socialPollWorkerEnabled: booleanValue(env.COMMS_HUB_ZERNIO_POLL_ENABLED, false),
    socialPollMs: positiveInteger(env.COMMS_HUB_ZERNIO_POLL_MS, 120_000, "COMMS_HUB_ZERNIO_POLL_MS", { min: 30_000, max: 3_600_000 }),
    socialPollLeaseMs: positiveInteger(env.COMMS_HUB_ZERNIO_POLL_LEASE_MS, 180_000, "COMMS_HUB_ZERNIO_POLL_LEASE_MS", { min: 30_000, max: 900_000 }),
    socialPollBatchSize: positiveInteger(env.COMMS_HUB_ZERNIO_POLL_BATCH_SIZE, 25, "COMMS_HUB_ZERNIO_POLL_BATCH_SIZE", { min: 1, max: 100 }),
    socialPollOverlapMs: positiveInteger(env.COMMS_HUB_ZERNIO_POLL_OVERLAP_MS, 7_200_000, "COMMS_HUB_ZERNIO_POLL_OVERLAP_MS", { min: 60_000, max: 86_400_000 }),
    socialPollMaxMessagePages: positiveInteger(env.COMMS_HUB_ZERNIO_MAX_MESSAGE_PAGES, 5, "COMMS_HUB_ZERNIO_MAX_MESSAGE_PAGES", { min: 1, max: 5 }),
    socialPollMaxCommentPages: positiveInteger(env.COMMS_HUB_ZERNIO_MAX_COMMENT_PAGES, 5, "COMMS_HUB_ZERNIO_MAX_COMMENT_PAGES", { min: 1, max: 10 }),
    emailEnabled: booleanValue(env.COMMS_HUB_EMAIL_ENABLED, false),
    oneComEmailAccountKey: usableEnvValue(env.COMMS_HUB_ONECOM_ACCOUNT_KEY),
    oneComEmailAddress: usableEnvValue(env.COMMS_HUB_ONECOM_EMAIL_ADDRESS),
    oneComEmailUsername: usableEnvValue(env.COMMS_HUB_ONECOM_USERNAME),
    oneComEmailPassword: usableEnvValue(env.COMMS_HUB_ONECOM_PASSWORD) || usableEnvValue(env.ONECOM_INFO_PASSWORD),
    emailAddressRoles: Object.freeze({
      admin: Object.freeze({
        address: usableEnvValue(env.COMMS_HUB_EMAIL_ADMIN_ADDRESS) || "admin@jonathan-harris.online",
        purpose: "service_admin",
        commsHubManaged: false,
      }),
      info: Object.freeze({
        address: usableEnvValue(env.COMMS_HUB_EMAIL_PRIMARY_ADDRESS) || usableEnvValue(env.COMMS_HUB_ONECOM_EMAIL_ADDRESS) || "info@jonathan-harris.online",
        purpose: "customer_facing",
        commsHubManaged: true,
      }),
      newsletter: Object.freeze({
        address: usableEnvValue(env.COMMS_HUB_EMAIL_NEWSLETTER_ADDRESS) || "newsletter@jonathan-harris.online",
        purpose: "newsletter_brevo",
        commsHubManaged: false,
      }),
    }),
    oneComImapHost: usableEnvValue(env.COMMS_HUB_ONECOM_IMAP_HOST) || "imap.one.com",
    oneComImapPort: positiveInteger(env.COMMS_HUB_ONECOM_IMAP_PORT, 993, "COMMS_HUB_ONECOM_IMAP_PORT", { min: 1, max: 65535 }),
    oneComSmtpHost: usableEnvValue(env.COMMS_HUB_ONECOM_SMTP_HOST) || "send.one.com",
    oneComSmtpPort: positiveInteger(env.COMMS_HUB_ONECOM_SMTP_PORT, 465, "COMMS_HUB_ONECOM_SMTP_PORT", { min: 1, max: 65535 }),
    oneComSmtpEhloName: usableEnvValue(env.COMMS_HUB_ONECOM_SMTP_EHLO_NAME) || "aims.jonathan-harris.online",
    oneComMailbox: usableEnvValue(env.COMMS_HUB_ONECOM_MAILBOX) || "INBOX",
    oneComEmailTimeoutMs: positiveInteger(env.COMMS_HUB_ONECOM_TIMEOUT_MS, 20_000, "COMMS_HUB_ONECOM_TIMEOUT_MS", { min: 1_000, max: 60_000 }),
    emailPollWorkerEnabled: booleanValue(env.COMMS_HUB_EMAIL_POLL_WORKER_ENABLED, false),
    emailPollMs: positiveInteger(env.COMMS_HUB_EMAIL_POLL_MS, 60_000, "COMMS_HUB_EMAIL_POLL_MS", { min: 30_000, max: 3_600_000 }),
    emailPollLeaseMs: positiveInteger(env.COMMS_HUB_EMAIL_POLL_LEASE_MS, 180_000, "COMMS_HUB_EMAIL_POLL_LEASE_MS", { min: 30_000, max: 900_000 }),
    emailPollBatchSize: positiveInteger(env.COMMS_HUB_EMAIL_POLL_BATCH_SIZE, 25, "COMMS_HUB_EMAIL_POLL_BATCH_SIZE", { min: 1, max: 100 }),
    emailHistoricalBackfillEnabled: booleanValue(env.COMMS_HUB_EMAIL_HISTORICAL_BACKFILL_ENABLED, false),
    emailWorkflowEvaluationEnabled: booleanValue(env.COMMS_HUB_EMAIL_WORKFLOW_EVALUATION_ENABLED, false),
    chatEnabled: booleanValue(env.COMMS_HUB_CHAT_ENABLED, false),
    coginPalApiBaseUrl: normaliseBaseUrl(env.COMMS_HUB_COGINPAL_API_BASE_URL, ""),
    coginPalApiKey: usableEnvValue(env.COMMS_HUB_COGINPAL_API_KEY),
    coginPalWebhookSecret: usableEnvValue(env.COMMS_HUB_COGINPAL_WEBHOOK_SECRET),
    coginPalTimeoutMs: positiveInteger(env.COMMS_HUB_COGINPAL_TIMEOUT_MS, 15_000, "COMMS_HUB_COGINPAL_TIMEOUT_MS", { min: 1_000, max: 30_000 }),
    webhookSignatureMaxAgeMs: positiveInteger(env.COMMS_HUB_WEBHOOK_SIGNATURE_MAX_AGE_MS, 300_000, "COMMS_HUB_WEBHOOK_SIGNATURE_MAX_AGE_MS", { min: 30_000, max: 3_600_000 }),
    wakeEnabled: booleanValue(env.COMMS_HUB_WAKE_ENABLED, false),
    wakeRequestUrl: normaliseBaseUrl(env.COMMS_HUB_WAKE_REQUEST_URL, ""),
    wakeRequestSecret: usableEnvValue(env.COMMS_HUB_WAKE_REQUEST_SECRET),
    wakeRequestTimeoutMs: positiveInteger(env.COMMS_HUB_WAKE_REQUEST_TIMEOUT_MS, 10_000, "COMMS_HUB_WAKE_REQUEST_TIMEOUT_MS", { min: 1_000, max: 30_000 }),
    attachmentMaxBytes: positiveInteger(env.COMMS_HUB_ATTACHMENT_MAX_BYTES, 20_971_520, "COMMS_HUB_ATTACHMENT_MAX_BYTES", { min: 1_024, max: 104_857_600 }),
    attachmentDownloadTimeoutMs: positiveInteger(env.COMMS_HUB_ATTACHMENT_DOWNLOAD_TIMEOUT_MS, 30_000, "COMMS_HUB_ATTACHMENT_DOWNLOAD_TIMEOUT_MS", { min: 1_000, max: 120_000 }),
    attachmentScannerProvider: (usableEnvValue(env.COMMS_HUB_ATTACHMENT_SCANNER_PROVIDER) || "cloudmersive").toLowerCase(),
    attachmentScannerUrl: normaliseBaseUrl(env.COMMS_HUB_ATTACHMENT_SCANNER_URL, "https://api.cloudmersive.com/virus/scan/file"),
    attachmentScannerToken: usableEnvValue(env.COMMS_HUB_ATTACHMENT_SCANNER_TOKEN),
    attachmentScanTimeoutMs: positiveInteger(env.COMMS_HUB_ATTACHMENT_SCAN_TIMEOUT_MS, 30_000, "COMMS_HUB_ATTACHMENT_SCAN_TIMEOUT_MS", { min: 1_000, max: 120_000 }),
    rbacDelegationSecret: usableEnvValue(env.COMMS_HUB_RBAC_DELEGATION_SECRET),
    rbacSignatureMaxAgeMs: positiveInteger(env.COMMS_HUB_RBAC_SIGNATURE_MAX_AGE_MS, 300_000, "COMMS_HUB_RBAC_SIGNATURE_MAX_AGE_MS", { min: 30_000, max: 3_600_000 }),
    suiteRole: usableEnvValue(env.COMMS_HUB_SUITE_ROLE) || "admin",
    delayedActionWorkerEnabled: booleanValue(env.COMMS_HUB_DELAYED_ACTION_WORKER_ENABLED, false),
    delayedActionPollMs: positiveInteger(env.COMMS_HUB_DELAYED_ACTION_POLL_MS, 60_000, "COMMS_HUB_DELAYED_ACTION_POLL_MS", { min: 30_000, max: 3_600_000 }),
    delayedActionLeaseMs: positiveInteger(env.COMMS_HUB_DELAYED_ACTION_LEASE_MS, 180_000, "COMMS_HUB_DELAYED_ACTION_LEASE_MS", { min: 30_000, max: 900_000 }),
    delayedActionBatchSize: positiveInteger(env.COMMS_HUB_DELAYED_ACTION_BATCH_SIZE, 20, "COMMS_HUB_DELAYED_ACTION_BATCH_SIZE", { min: 1, max: 100 }),
    retentionWorkerEnabled: booleanValue(env.COMMS_HUB_RETENTION_WORKER_ENABLED, false),
    retentionPollMs: positiveInteger(env.COMMS_HUB_RETENTION_POLL_MS, 86_400_000, "COMMS_HUB_RETENTION_POLL_MS", { min: 3_600_000, max: 604_800_000 }),
    retentionBatchSize: positiveInteger(env.COMMS_HUB_RETENTION_BATCH_SIZE, 50, "COMMS_HUB_RETENTION_BATCH_SIZE", { min: 1, max: 500 }),
    autonomousRepliesEnabled: booleanValue(env.COMMS_HUB_AUTONOMOUS_REPLIES_ENABLED, false),
    credentialVaultEnabled: booleanValue(env.COMMS_HUB_CREDENTIAL_VAULT_ENABLED, false),
    credentialMasterKey: usableEnvValue(env.COMMS_HUB_CREDENTIAL_MASTER_KEY),
    oauthAllowedScopes: Object.freeze(csvValue(env.COMMS_HUB_OAUTH_ALLOWED_SCOPES)),
    notificationEmailMap: Object.freeze(jsonValue(env.COMMS_HUB_NOTIFICATION_EMAIL_MAP, {})),
    notificationDefaultEmail: usableEnvValue(env.COMMS_HUB_NOTIFICATION_DEFAULT_EMAIL),
  });
}

export default loadCommsHubConfig;
