import { CommsHubError } from "./errors.js";

export const COMMS_HUB_FORM_ROUTES = Object.freeze({
  "260281179574362": Object.freeze({
    key: "contact",
    label: "Contact form",
    workflow: "contact_intake",
    subject: "Contact form submission",
    defaultUrl: "https://form.jotform.com/260281179574362",
  }),
  "262063136008044": Object.freeze({
    key: "case_study",
    label: "Case study contribution form",
    workflow: "case_study_intake",
    subject: "Case study submission",
    defaultUrl: "https://form.jotform.com/262063136008044",
  }),
  "262097861889073": Object.freeze({
    key: "podcast_enquiry",
    label: "Podcast enquiry form",
    workflow: "podcast_enquiry_intake",
    subject: "Podcast enquiry",
    defaultUrl: "https://form.jotform.com/262097861889073",
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


export const SOCIAL_CHANNEL_CAPABILITIES = Object.freeze({
  facebook: Object.freeze({
    family: "meta",
    directMessages: true,
    messageAttachments: true,
    markRead: true,
    conversationStatus: true,
    comments: true,
    commentReplies: true,
    privateCommentReplies: true,
    commentAttachments: true,
    hideComments: true,
    deleteComments: true,
    moderation: false,
    liveChat: false,
    pollingResources: Object.freeze(["conversations", "comments"]),
  }),
  instagram: Object.freeze({
    family: "meta",
    directMessages: true,
    messageAttachments: true,
    markRead: true,
    conversationStatus: true,
    comments: true,
    commentReplies: true,
    privateCommentReplies: true,
    commentAttachments: false,
    hideComments: true,
    deleteComments: true,
    moderation: false,
    liveChat: false,
    pollingResources: Object.freeze(["conversations", "comments"]),
  }),
  youtube: Object.freeze({
    family: "video",
    directMessages: false,
    messageAttachments: false,
    markRead: false,
    conversationStatus: false,
    comments: true,
    commentReplies: true,
    privateCommentReplies: false,
    commentAttachments: false,
    hideComments: false,
    deleteComments: true,
    moderation: true,
    liveChat: false,
    pollingResources: Object.freeze(["comments"]),
  }),
});

export function socialChannelCapabilities(platform) {
  const key = normalise(platform).toLowerCase();
  const capabilities = SOCIAL_CHANNEL_CAPABILITIES[key];
  if (!capabilities) return null;
  return {
    platform: key,
    ...capabilities,
    pollingResources: [...capabilities.pollingResources],
  };
}

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

export function effectiveChatEnabled(env = process.env) {
  // First-party CogniPal is considered enabled whenever its server-side HMAC
  // secret is configured. This avoids a stale rollout flag silently turning the
  // public route into a 404 after the website has already been deployed.
  // COMMS_HUB_CHAT_FORCE_DISABLED remains the explicit emergency kill switch.
  if (booleanValue(env.COMMS_HUB_CHAT_FORCE_DISABLED, false)) return false;
  if (usableEnvValue(env.COMMS_HUB_COGINPAL_WEBHOOK_SECRET)) return true;
  return booleanValue(env.COMMS_HUB_CHAT_ENABLED, false);
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
  const delayedRepliesRequired = booleanValue(env.COMMS_HUB_EMAIL_INITIAL_REPLY_DELAY_ENABLED, true)
    || booleanValue(env.COMMS_HUB_FORM_REPLY_DELAY_ENABLED, true);
  const contentAutomationRequired = booleanValue(env.COMMS_HUB_CONTENT_AUTOMATION_ENABLED, false);
  if ((delayedRepliesRequired || contentAutomationRequired) && !booleanValue(env.COMMS_HUB_DELAYED_ACTION_WORKER_ENABLED, true)) {
    missing.push("COMMS_HUB_DELAYED_ACTION_WORKER_ENABLED");
  }
  if (contentAutomationRequired && !usableEnvValue(env.R2_BUCKET_COMMS_HUB_PRIVATE)) {
    missing.push("R2_BUCKET_COMMS_HUB_PRIVATE");
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
    // COMMS_HUB_RESTORE_DATABASE_ID is an optional override. When absent, AIMS
    // discovers or creates the isolated restore database by name at runtime.
    if (restoreDatabase && restoreDatabase === sourceDatabase) missing.push("COMMS_HUB_RESTORE_DATABASE_ID");
  }
  if (booleanValue(env.COMMS_HUB_EMAIL_ENABLED, false)) {
    for (const name of ["COMMS_HUB_ONECOM_EMAIL_ADDRESS", "COMMS_HUB_ONECOM_USERNAME", "COMMS_HUB_ONECOM_IMAP_HOST", "COMMS_HUB_ONECOM_SMTP_HOST", "R2_BUCKET_COMMS_HUB_PRIVATE", "COMMS_HUB_ATTACHMENT_SCANNER_URL", "COMMS_HUB_ATTACHMENT_SCANNER_TOKEN"]) {
      if (!usableEnvValue(env[name])) missing.push(name);
    }
    if (!usableEnvValue(env.COMMS_HUB_ONECOM_PASSWORD) && !usableEnvValue(env.ONECOM_INFO_PASSWORD)) {
      missing.push("ONECOM_INFO_PASSWORD");
    }
  }
  if (effectiveChatEnabled(env)) {
    if (!usableEnvValue(env.COMMS_HUB_COGINPAL_WEBHOOK_SECRET)) missing.push("COMMS_HUB_COGINPAL_WEBHOOK_SECRET");
    const coginPalApiBaseUrl = usableEnvValue(env.COMMS_HUB_COGINPAL_API_BASE_URL);
    const coginPalApiKey = usableEnvValue(env.COMMS_HUB_COGINPAL_API_KEY);
    if ((coginPalApiBaseUrl && !coginPalApiKey) || (!coginPalApiBaseUrl && coginPalApiKey)) {
      missing.push(coginPalApiBaseUrl ? "COMMS_HUB_COGINPAL_API_KEY" : "COMMS_HUB_COGINPAL_API_BASE_URL");
    }
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
      chat: effectiveChatEnabled(env),
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
  const jotformForms = Object.freeze({
    contact: Object.freeze({ ...COMMS_HUB_FORM_ROUTES["260281179574362"], formId: "260281179574362", url: normaliseBaseUrl(env.COMMS_HUB_JOTFORM_CONTACT_URL, COMMS_HUB_FORM_ROUTES["260281179574362"].defaultUrl) }),
    case_study: Object.freeze({ ...COMMS_HUB_FORM_ROUTES["262063136008044"], formId: "262063136008044", url: normaliseBaseUrl(env.COMMS_HUB_JOTFORM_CASE_STUDY_URL, COMMS_HUB_FORM_ROUTES["262063136008044"].defaultUrl) }),
    podcast_enquiry: Object.freeze({ ...COMMS_HUB_FORM_ROUTES["262097861889073"], formId: "262097861889073", url: normaliseBaseUrl(env.COMMS_HUB_JOTFORM_PODCAST_URL, COMMS_HUB_FORM_ROUTES["262097861889073"].defaultUrl) }),
  });

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

  const businessStartHour = positiveInteger(env.COMMS_HUB_BUSINESS_START_HOUR, 9, 'COMMS_HUB_BUSINESS_START_HOUR', { min: 0, max: 23 });
  const businessEndHour = positiveInteger(env.COMMS_HUB_BUSINESS_END_HOUR, 17, 'COMMS_HUB_BUSINESS_END_HOUR', { min: 1, max: 24 });
  if (businessStartHour >= businessEndHour) {
    throw new CommsHubError(503, 'comms_hub_configuration_invalid', 'COMMS_HUB_BUSINESS_START_HOUR must be earlier than COMMS_HUB_BUSINESS_END_HOUR.');
  }
  const replyDelayMinDays = positiveInteger(env.COMMS_HUB_REPLY_DELAY_MIN_DAYS || env.COMMS_HUB_REPLY_DELAY_MIN_BUSINESS_DAYS, 2, 'COMMS_HUB_REPLY_DELAY_MIN_DAYS', { min: 1, max: 10 });
  const replyDelayMaxDays = positiveInteger(env.COMMS_HUB_REPLY_DELAY_MAX_DAYS || env.COMMS_HUB_REPLY_DELAY_MAX_BUSINESS_DAYS, 3, 'COMMS_HUB_REPLY_DELAY_MAX_DAYS', { min: 1, max: 10 });
  if (replyDelayMinDays > replyDelayMaxDays) {
    throw new CommsHubError(503, 'comms_hub_configuration_invalid', 'COMMS_HUB_REPLY_DELAY_MIN_DAYS cannot exceed COMMS_HUB_REPLY_DELAY_MAX_DAYS.');
  }
  const humanHandoffBusinessHoursOnly = booleanValue(env.COMMS_HUB_HUMAN_HANDOFF_BUSINESS_HOURS_ONLY, true);
  if (!humanHandoffBusinessHoursOnly) {
    throw new CommsHubError(503, 'comms_hub_configuration_invalid', 'COMMS_HUB_HUMAN_HANDOFF_BUSINESS_HOURS_ONLY must remain true. Human hand-off is restricted to Monday-Friday 09:00-17:00 UK time.');
  }

  const primaryEmailAddress = usableEnvValue(env.COMMS_HUB_EMAIL_PRIMARY_ADDRESS) || usableEnvValue(env.COMMS_HUB_ONECOM_EMAIL_ADDRESS) || "info@jonathan-harris.online";
  const primaryEmailUsername = usableEnvValue(env.COMMS_HUB_ONECOM_USERNAME) || primaryEmailAddress;
  const oneComMailbox = usableEnvValue(env.COMMS_HUB_ONECOM_MAILBOX) || "INBOX";
  // Only info@ is a Comms Hub-managed mailbox. Admin and newsletter are hard
  // exclusions: stale deployment flags or credentials must never create pollers,
  // workflow evaluation, AI classification or outbound delivery for those inboxes.
  const emailAccounts = Object.freeze({
    info: Object.freeze({
      key: "info",
      enabled: booleanValue(env.COMMS_HUB_EMAIL_ENABLED, false),
      address: primaryEmailAddress,
      username: primaryEmailUsername,
      password: usableEnvValue(env.COMMS_HUB_ONECOM_PASSWORD) || usableEnvValue(env.ONECOM_INFO_PASSWORD),
      mailbox: oneComMailbox,
      mailboxRole: "customer_facing",
      manualOnly: false,
      workflowEvaluationEnabled: booleanValue(env.COMMS_HUB_EMAIL_WORKFLOW_EVALUATION_ENABLED, aiEnabled),
    }),
  });
  const excludedEmailAccounts = Object.freeze({
    admin: Object.freeze({
      key: "admin",
      address: usableEnvValue(env.COMMS_HUB_EMAIL_ADMIN_ADDRESS) || "admin@jonathan-harris.online",
      purpose: "service_admin",
      automationExcluded: true,
    }),
    newsletter: Object.freeze({
      key: "newsletter",
      address: usableEnvValue(env.COMMS_HUB_EMAIL_NEWSLETTER_ADDRESS) || "newsletter@jonathan-harris.online",
      purpose: "newsletter_brevo",
      automationExcluded: true,
    }),
  });

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
    jotformForms,
    smartResponseEnabled: booleanValue(env.COMMS_HUB_SMART_RESPONSE_ENABLED, true),
    smartResponseMinimumConfidence: decimalValue(env.COMMS_HUB_SMART_RESPONSE_MIN_CONFIDENCE, 0.86, "COMMS_HUB_SMART_RESPONSE_MIN_CONFIDENCE"),
    formOrchestrationEnabled: booleanValue(env.COMMS_HUB_FORM_ORCHESTRATION_ENABLED, true),
    formSmartProcessingEnabled: booleanValue(env.COMMS_HUB_FORM_SMART_PROCESSING_ENABLED, true),
    formAutoSendEnabled: booleanValue(env.COMMS_HUB_FORM_AUTO_SEND_ENABLED, aiEnabled),
    contentAutomationEnabled: booleanValue(env.COMMS_HUB_CONTENT_AUTOMATION_ENABLED, false),
    contentAutomationBlogEnabled: booleanValue(env.COMMS_HUB_CONTENT_AUTOMATION_BLOG_ENABLED, true),
    contentAutomationSocialEnabled: booleanValue(env.COMMS_HUB_CONTENT_AUTOMATION_SOCIAL_ENABLED, true),
    contentAutomationPodcastEnabled: booleanValue(env.COMMS_HUB_CONTENT_AUTOMATION_PODCAST_ENABLED, true),
    contentAutomationMaxFacts: positiveInteger(env.COMMS_HUB_CONTENT_AUTOMATION_MAX_FACTS, 12, "COMMS_HUB_CONTENT_AUTOMATION_MAX_FACTS", { min: 1, max: 30 }),
    contentAutomationMaxAttempts: positiveInteger(env.COMMS_HUB_CONTENT_AUTOMATION_MAX_ATTEMPTS, 8, "COMMS_HUB_CONTENT_AUTOMATION_MAX_ATTEMPTS", { min: 1, max: 20 }),
    contentAutomationBriefLimit: positiveInteger(env.COMMS_HUB_CONTENT_AUTOMATION_BRIEF_LIMIT, 3, "COMMS_HUB_CONTENT_AUTOMATION_BRIEF_LIMIT", { min: 1, max: 10 }),
    businessTimeZone: usableEnvValue(env.COMMS_HUB_BUSINESS_TIMEZONE) || 'Europe/London',
    businessStartHour,
    businessEndHour,
    emailInitialReplyDelayEnabled: booleanValue(env.COMMS_HUB_EMAIL_INITIAL_REPLY_DELAY_ENABLED, true),
    formReplyDelayEnabled: booleanValue(env.COMMS_HUB_FORM_REPLY_DELAY_ENABLED, true),
    replyDelayMinDays,
    replyDelayMaxDays,
    humanHandoffBusinessHoursOnly,
    callbackEmailCaptureEnabled: booleanValue(env.COMMS_HUB_CALLBACK_EMAIL_CAPTURE_ENABLED, true),
    formRequestExpiryHours: positiveInteger(env.COMMS_HUB_FORM_REQUEST_EXPIRY_HOURS, 336, "COMMS_HUB_FORM_REQUEST_EXPIRY_HOURS", { min: 1, max: 2160 }),
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
    smartContextEnabled: booleanValue(env.COMMS_HUB_SMART_CONTEXT_ENABLED, true),
    smartMaximumBookCandidates: positiveInteger(env.COMMS_HUB_SMART_MAX_BOOK_CANDIDATES, 3, "COMMS_HUB_SMART_MAX_BOOK_CANDIDATES", { min: 1, max: 6 }),
    smartLiveContentEnabled: booleanValue(env.COMMS_HUB_SMART_LIVE_CONTENT_ENABLED, true),
    smartLiveContentMaxItems: positiveInteger(env.COMMS_HUB_SMART_LIVE_CONTENT_MAX_ITEMS, 4, "COMMS_HUB_SMART_LIVE_CONTENT_MAX_ITEMS", { min: 1, max: 8 }),
    smartStrategyEnabled: booleanValue(env.COMMS_HUB_SMART_STRATEGY_ENABLED, true),
    smartConductEnabled: booleanValue(env.COMMS_HUB_SMART_CONDUCT_ENABLED, true),
    badLanguageBlockEnabled: booleanValue(env.COMMS_HUB_BAD_LANGUAGE_BLOCK_ENABLED, true),
    conductReviewStrikeThreshold: positiveInteger(env.COMMS_HUB_CONDUCT_REVIEW_STRIKES, 2, "COMMS_HUB_CONDUCT_REVIEW_STRIKES", { min: 1, max: 10 }),
    conductAutomationBlockThreshold: positiveInteger(env.COMMS_HUB_CONDUCT_AUTOMATION_BLOCK_STRIKES, 2, "COMMS_HUB_CONDUCT_AUTOMATION_BLOCK_STRIKES", { min: 1, max: 10 }),
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
    restoreDatabaseName: usableEnvValue(env.COMMS_HUB_RESTORE_DATABASE) || "COMMS_HUB_RESTORE_DATABASE",
    restoreDatabaseId: usableEnvValue(env.COMMS_HUB_RESTORE_DATABASE_ID),
    backupObjectPrefixes: Object.freeze(csvValue(env.COMMS_HUB_BACKUP_OBJECT_PREFIXES || "attachments/,conversation-assets/")),
    backupMaxLinkedObjects: positiveInteger(env.COMMS_HUB_BACKUP_MAX_LINKED_OBJECTS, 1000, "COMMS_HUB_BACKUP_MAX_LINKED_OBJECTS", { min: 1, max: 10000 }),
    maxWebhookBytes: positiveInteger(env.COMMS_HUB_MAX_WEBHOOK_BYTES, 1_048_576, "COMMS_HUB_MAX_WEBHOOK_BYTES", { max: 10_485_760 }),
    jotformTimeoutMs: positiveInteger(env.COMMS_HUB_JOTFORM_TIMEOUT_MS, 10_000, "COMMS_HUB_JOTFORM_TIMEOUT_MS", { min: 1_000, max: 25_000 }),
    jotformSourceTimeZone: usableEnvValue(env.COMMS_HUB_JOTFORM_SOURCE_TIMEZONE) || "UTC",
    zernioTimeoutMs: positiveInteger(env.COMMS_HUB_ZERNIO_TIMEOUT_MS, 15_000, "COMMS_HUB_ZERNIO_TIMEOUT_MS", { min: 1_000, max: 30_000 }),
    zernioAckTimeoutMs: positiveInteger(env.COMMS_HUB_ZERNIO_ACK_TIMEOUT_MS, 4_000, "COMMS_HUB_ZERNIO_ACK_TIMEOUT_MS", { min: 500, max: 4_500 }),
    d1TimeoutMs: positiveInteger(env.COMMS_HUB_D1_TIMEOUT_MS, 15_000, "COMMS_HUB_D1_TIMEOUT_MS", { min: 1_000, max: 30_000 }),
    autoMigrateOnStart: booleanValue(env.COMMS_HUB_AUTO_MIGRATE_ON_START, true),
    runtimeSupervisorEnabled: booleanValue(env.COMMS_HUB_RUNTIME_SUPERVISOR_ENABLED, true),
    runtimeSupervisorRetryMs: positiveInteger(env.COMMS_HUB_RUNTIME_SUPERVISOR_RETRY_MS, 30_000, "COMMS_HUB_RUNTIME_SUPERVISOR_RETRY_MS", { min: 5_000, max: 300_000 }),
    runtimeSupervisorMaxRetryMs: positiveInteger(env.COMMS_HUB_RUNTIME_SUPERVISOR_MAX_RETRY_MS, 300_000, "COMMS_HUB_RUNTIME_SUPERVISOR_MAX_RETRY_MS", { min: 30_000, max: 3_600_000 }),
    providerRetryAttempts: positiveInteger(env.COMMS_HUB_PROVIDER_RETRY_ATTEMPTS, 4, "COMMS_HUB_PROVIDER_RETRY_ATTEMPTS", { max: 8 }),
    providerRetryBaseMs: positiveInteger(env.COMMS_HUB_PROVIDER_RETRY_BASE_MS, 500, "COMMS_HUB_PROVIDER_RETRY_BASE_MS", { min: 100, max: 10_000 }),
    providerRetryMaxMs: positiveInteger(env.COMMS_HUB_PROVIDER_RETRY_MAX_MS, 8_000, "COMMS_HUB_PROVIDER_RETRY_MAX_MS", { min: 500, max: 30_000 }),
    archiveWorkerEnabled: booleanValue(env.COMMS_HUB_ARCHIVE_WORKER_ENABLED, true),
    archivePollMs: positiveInteger(env.COMMS_HUB_ARCHIVE_POLL_MS, 60_000, "COMMS_HUB_ARCHIVE_POLL_MS", { min: 5_000, max: 3_600_000 }),
    archiveBatchSize: positiveInteger(env.COMMS_HUB_ARCHIVE_BATCH_SIZE, 10, "COMMS_HUB_ARCHIVE_BATCH_SIZE", { max: 100 }),
    archiveLeaseMs: positiveInteger(env.COMMS_HUB_ARCHIVE_LEASE_MS, 120_000, "COMMS_HUB_ARCHIVE_LEASE_MS", { min: 30_000, max: 900_000 }),
    archiveMaxAttempts: positiveInteger(env.COMMS_HUB_ARCHIVE_MAX_ATTEMPTS, 10, "COMMS_HUB_ARCHIVE_MAX_ATTEMPTS", { max: 50 }),
    socialMonitorOnly: booleanValue(env.COMMS_HUB_SOCIAL_MONITOR_ONLY, false),
    socialPollWorkerEnabled: booleanValue(env.COMMS_HUB_ZERNIO_POLL_ENABLED, Object.values(zernioFamilies).some((family) => family.enabled)),
    socialPollMs: positiveInteger(env.COMMS_HUB_ZERNIO_POLL_MS, 120_000, "COMMS_HUB_ZERNIO_POLL_MS", { min: 30_000, max: 3_600_000 }),
    socialPollLeaseMs: positiveInteger(env.COMMS_HUB_ZERNIO_POLL_LEASE_MS, 180_000, "COMMS_HUB_ZERNIO_POLL_LEASE_MS", { min: 30_000, max: 900_000 }),
    socialPollBatchSize: positiveInteger(env.COMMS_HUB_ZERNIO_POLL_BATCH_SIZE, 25, "COMMS_HUB_ZERNIO_POLL_BATCH_SIZE", { min: 1, max: 100 }),
    socialPollOverlapMs: positiveInteger(env.COMMS_HUB_ZERNIO_POLL_OVERLAP_MS, 7_200_000, "COMMS_HUB_ZERNIO_POLL_OVERLAP_MS", { min: 60_000, max: 86_400_000 }),
    socialPollMaxMessagePages: positiveInteger(env.COMMS_HUB_ZERNIO_MAX_MESSAGE_PAGES, 5, "COMMS_HUB_ZERNIO_MAX_MESSAGE_PAGES", { min: 1, max: 5 }),
    socialPollMaxCommentPages: positiveInteger(env.COMMS_HUB_ZERNIO_MAX_COMMENT_PAGES, 5, "COMMS_HUB_ZERNIO_MAX_COMMENT_PAGES", { min: 1, max: 10 }),
    zernioWebhookReconcileEnabled: booleanValue(env.COMMS_HUB_ZERNIO_WEBHOOK_RECONCILE_ENABLED, true),
    zernioWebhookReconcileIntervalMs: positiveInteger(env.COMMS_HUB_ZERNIO_WEBHOOK_RECONCILE_INTERVAL_MS, 900_000, "COMMS_HUB_ZERNIO_WEBHOOK_RECONCILE_INTERVAL_MS", { min: 60_000, max: 86_400_000 }),
    emailEnabled: booleanValue(env.COMMS_HUB_EMAIL_ENABLED, false),
    emailExternalRecipientsEnabled: booleanValue(env.COMMS_HUB_EMAIL_EXTERNAL_RECIPIENTS_ENABLED, false),
    emailMaxReplyChars: positiveInteger(env.COMMS_HUB_EMAIL_MAX_REPLY_CHARS, 20_000, "COMMS_HUB_EMAIL_MAX_REPLY_CHARS", { min: 1000, max: 100_000 }),
    emailAccounts,
    excludedEmailAccounts,
    oneComEmailAccountKey: emailAccounts.info.key,
    oneComEmailAddress: emailAccounts.info.address,
    oneComEmailUsername: emailAccounts.info.username,
    oneComEmailPassword: emailAccounts.info.password,
    emailAddressRoles: Object.freeze({
      admin: Object.freeze({
        address: excludedEmailAccounts.admin.address,
        purpose: "service_admin",
        commsHubManaged: false,
        automationExcluded: true,
      }),
      info: Object.freeze({
        address: emailAccounts.info.address,
        purpose: "customer_facing",
        commsHubManaged: true,
        automationExcluded: false,
      }),
      newsletter: Object.freeze({
        address: excludedEmailAccounts.newsletter.address,
        purpose: "newsletter_brevo",
        commsHubManaged: false,
        automationExcluded: true,
      }),
    }),
    oneComImapHost: usableEnvValue(env.COMMS_HUB_ONECOM_IMAP_HOST) || "imap.one.com",
    oneComImapPort: positiveInteger(env.COMMS_HUB_ONECOM_IMAP_PORT, 993, "COMMS_HUB_ONECOM_IMAP_PORT", { min: 1, max: 65535 }),
    oneComSmtpHost: usableEnvValue(env.COMMS_HUB_ONECOM_SMTP_HOST) || "send.one.com",
    oneComSmtpPort: positiveInteger(env.COMMS_HUB_ONECOM_SMTP_PORT, 465, "COMMS_HUB_ONECOM_SMTP_PORT", { min: 1, max: 65535 }),
    oneComSmtpEhloName: usableEnvValue(env.COMMS_HUB_ONECOM_SMTP_EHLO_NAME) || "aims.jonathan-harris.online",
    oneComMailbox,
    oneComEmailTimeoutMs: positiveInteger(env.COMMS_HUB_ONECOM_TIMEOUT_MS, 20_000, "COMMS_HUB_ONECOM_TIMEOUT_MS", { min: 1_000, max: 60_000 }),
    emailPollWorkerEnabled: booleanValue(env.COMMS_HUB_EMAIL_POLL_WORKER_ENABLED, booleanValue(env.COMMS_HUB_EMAIL_ENABLED, false)),
    emailPollMs: positiveInteger(env.COMMS_HUB_EMAIL_POLL_MS, 60_000, "COMMS_HUB_EMAIL_POLL_MS", { min: 30_000, max: 3_600_000 }),
    emailPollLeaseMs: positiveInteger(env.COMMS_HUB_EMAIL_POLL_LEASE_MS, 180_000, "COMMS_HUB_EMAIL_POLL_LEASE_MS", { min: 30_000, max: 900_000 }),
    emailPollBatchSize: positiveInteger(env.COMMS_HUB_EMAIL_POLL_BATCH_SIZE, 25, "COMMS_HUB_EMAIL_POLL_BATCH_SIZE", { min: 1, max: 100 }),
    emailHistoricalBackfillEnabled: booleanValue(env.COMMS_HUB_EMAIL_HISTORICAL_BACKFILL_ENABLED, false),
    emailWorkflowEvaluationEnabled: booleanValue(env.COMMS_HUB_EMAIL_WORKFLOW_EVALUATION_ENABLED, aiEnabled),
    chatEnabled: effectiveChatEnabled(env),
    coginPalApiBaseUrl: normaliseBaseUrl(env.COMMS_HUB_COGINPAL_API_BASE_URL, ""),
    coginPalApiKey: usableEnvValue(env.COMMS_HUB_COGINPAL_API_KEY),
    coginPalWebhookSecret: usableEnvValue(env.COMMS_HUB_COGINPAL_WEBHOOK_SECRET),
    coginPalTimeoutMs: positiveInteger(env.COMMS_HUB_COGINPAL_TIMEOUT_MS, 15_000, "COMMS_HUB_COGINPAL_TIMEOUT_MS", { min: 1_000, max: 30_000 }),
    chatMaxMessageChars: positiveInteger(env.COMMS_HUB_CHAT_MAX_MESSAGE_CHARS, 4000, "COMMS_HUB_CHAT_MAX_MESSAGE_CHARS", { min: 200, max: 20_000 }),
    chatMaxMessagesPerMinute: positiveInteger(env.COMMS_HUB_CHAT_MAX_MESSAGES_PER_MINUTE, 12, "COMMS_HUB_CHAT_MAX_MESSAGES_PER_MINUTE", { min: 1, max: 120 }),
    chatHistoryLimit: positiveInteger(env.COMMS_HUB_CHAT_HISTORY_LIMIT, 100, "COMMS_HUB_CHAT_HISTORY_LIMIT", { min: 10, max: 250 }),
    chatAiWorkflowEnabled: booleanValue(env.COMMS_HUB_CHAT_AI_WORKFLOW_ENABLED, aiEnabled),
    webhookSignatureMaxAgeMs: positiveInteger(env.COMMS_HUB_WEBHOOK_SIGNATURE_MAX_AGE_MS, 300_000, "COMMS_HUB_WEBHOOK_SIGNATURE_MAX_AGE_MS", { min: 30_000, max: 3_600_000 }),
    attachmentMaxBytes: positiveInteger(env.COMMS_HUB_ATTACHMENT_MAX_BYTES, 20_971_520, "COMMS_HUB_ATTACHMENT_MAX_BYTES", { min: 1_024, max: 104_857_600 }),
    attachmentDownloadTimeoutMs: positiveInteger(env.COMMS_HUB_ATTACHMENT_DOWNLOAD_TIMEOUT_MS, 30_000, "COMMS_HUB_ATTACHMENT_DOWNLOAD_TIMEOUT_MS", { min: 1_000, max: 120_000 }),
    attachmentScannerProvider: (usableEnvValue(env.COMMS_HUB_ATTACHMENT_SCANNER_PROVIDER) || "cloudmersive").toLowerCase(),
    attachmentScannerUrl: normaliseBaseUrl(env.COMMS_HUB_ATTACHMENT_SCANNER_URL, "https://api.cloudmersive.com/virus/scan/file"),
    attachmentScannerToken: usableEnvValue(env.COMMS_HUB_ATTACHMENT_SCANNER_TOKEN),
    attachmentScanTimeoutMs: positiveInteger(env.COMMS_HUB_ATTACHMENT_SCAN_TIMEOUT_MS, 30_000, "COMMS_HUB_ATTACHMENT_SCAN_TIMEOUT_MS", { min: 1_000, max: 120_000 }),
    rbacDelegationSecret: usableEnvValue(env.COMMS_HUB_RBAC_DELEGATION_SECRET),
    rbacSignatureMaxAgeMs: positiveInteger(env.COMMS_HUB_RBAC_SIGNATURE_MAX_AGE_MS, 300_000, "COMMS_HUB_RBAC_SIGNATURE_MAX_AGE_MS", { min: 30_000, max: 3_600_000 }),
    suiteRole: usableEnvValue(env.COMMS_HUB_SUITE_ROLE) || "admin",
    delayedActionWorkerEnabled: booleanValue(env.COMMS_HUB_DELAYED_ACTION_WORKER_ENABLED, true),
    delayedActionPollMs: positiveInteger(env.COMMS_HUB_DELAYED_ACTION_POLL_MS, 60_000, "COMMS_HUB_DELAYED_ACTION_POLL_MS", { min: 30_000, max: 3_600_000 }),
    delayedActionLeaseMs: positiveInteger(env.COMMS_HUB_DELAYED_ACTION_LEASE_MS, 180_000, "COMMS_HUB_DELAYED_ACTION_LEASE_MS", { min: 30_000, max: 900_000 }),
    delayedActionBatchSize: positiveInteger(env.COMMS_HUB_DELAYED_ACTION_BATCH_SIZE, 20, "COMMS_HUB_DELAYED_ACTION_BATCH_SIZE", { min: 1, max: 100 }),
    retentionWorkerEnabled: booleanValue(env.COMMS_HUB_RETENTION_WORKER_ENABLED, false),
    retentionPollMs: positiveInteger(env.COMMS_HUB_RETENTION_POLL_MS, 86_400_000, "COMMS_HUB_RETENTION_POLL_MS", { min: 3_600_000, max: 604_800_000 }),
    retentionBatchSize: positiveInteger(env.COMMS_HUB_RETENTION_BATCH_SIZE, 50, "COMMS_HUB_RETENTION_BATCH_SIZE", { min: 1, max: 500 }),
    monthEndArchiveEnabled: booleanValue(env.COMMS_HUB_MONTH_END_ARCHIVE_ENABLED, true),
    monthEndArchivePollMs: positiveInteger(env.COMMS_HUB_MONTH_END_ARCHIVE_POLL_MS, 21_600_000, "COMMS_HUB_MONTH_END_ARCHIVE_POLL_MS", { min: 3_600_000, max: 86_400_000 }),
    monthEndArchiveBatchSize: positiveInteger(env.COMMS_HUB_MONTH_END_ARCHIVE_BATCH_SIZE, 100, "COMMS_HUB_MONTH_END_ARCHIVE_BATCH_SIZE", { min: 1, max: 500 }),
    autonomousRepliesEnabled: booleanValue(env.COMMS_HUB_AUTONOMOUS_REPLIES_ENABLED, aiEnabled),
    credentialVaultEnabled: booleanValue(env.COMMS_HUB_CREDENTIAL_VAULT_ENABLED, false),
    credentialMasterKey: usableEnvValue(env.COMMS_HUB_CREDENTIAL_MASTER_KEY),
    oauthAllowedScopes: Object.freeze(csvValue(env.COMMS_HUB_OAUTH_ALLOWED_SCOPES)),
    notificationEmailMap: Object.freeze(jsonValue(env.COMMS_HUB_NOTIFICATION_EMAIL_MAP, {})),
    notificationDefaultEmail: usableEnvValue(env.COMMS_HUB_NOTIFICATION_DEFAULT_EMAIL),
  });
}

export default loadCommsHubConfig;
