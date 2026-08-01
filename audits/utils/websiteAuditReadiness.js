const DEFAULT_RAMS_BASE_URL = "https://mod.jonathan-harris.online";

function clean(value) {
  const text = String(value || "").trim();
  return /^\{\{\s*secret\.[^}]+\}\}$/i.test(text) ? "" : text;
}

function bool(value, fallback = false) {
  const text = clean(value).toLowerCase();
  if (!text) return fallback;
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  return fallback;
}

function any(env, names) {
  return names.some((name) => Boolean(clean(env[name])));
}

function check(name, ok, detail) {
  return { name, ok: Boolean(ok), detail };
}

export function getWebsiteAuditReadiness(env = process.env) {
  const ramsEnabled = bool(env.WEBSITE_AUDIT_TRIGGER_RAMS, true);
  const waitForRams = bool(env.RAMS_WAIT_FOR_COMPLETION, true);
  const ramsBaseUrl = clean(env.RAMS_BASE_URL || env.RMS_BASE_URL || DEFAULT_RAMS_BASE_URL);

  const checks = [
    check("audit_r2_bucket", Boolean(clean(env.R2_BUCKET_AUDITS)), "R2_BUCKET_AUDITS"),
    check("audit_r2_public_url", Boolean(clean(env.R2_PUBLIC_BASE_URL_AUDITS)), "R2_PUBLIC_BASE_URL_AUDITS"),
    check("r2_endpoint", any(env, ["R2_ENDPOINT", "R2_ENDPOINT_URL"]), "R2_ENDPOINT or R2_ENDPOINT_URL"),
    check("r2_access_key", Boolean(clean(env.R2_ACCESS_KEY_ID)), "R2_ACCESS_KEY_ID"),
    check("r2_secret_key", Boolean(clean(env.R2_SECRET_ACCESS_KEY)), "R2_SECRET_ACCESS_KEY"),
    check("audit_callback_base", any(env, ["AUDIT_CALLBACK_BASE_URL", "APP_URL"]), "AUDIT_CALLBACK_BASE_URL or APP_URL"),
    check("audit_callback_token", any(env, ["AUDIT_CALLBACK_TOKEN", "AI_SUITE_AUDIT_CALLBACK_TOKEN"]), "AUDIT_CALLBACK_TOKEN or AI_SUITE_AUDIT_CALLBACK_TOKEN"),
    check("github_audit_token", Boolean(clean(env.GITHUB_TOKEN_WEBSITE_AUDITS)), "GITHUB_TOKEN_WEBSITE_AUDITS"),
    check("github_audit_owner", Boolean(clean(env.AUDIT_WEBSITE_REPO_OWNER)), "AUDIT_WEBSITE_REPO_OWNER"),
    check("github_audit_repo", Boolean(clean(env.AUDIT_WEBSITE_REPO_NAME)), "AUDIT_WEBSITE_REPO_NAME"),
    check("rams_handoff_enabled", ramsEnabled, "WEBSITE_AUDIT_TRIGGER_RAMS=true"),
    check("rams_base_url", !ramsEnabled || Boolean(ramsBaseUrl), "RAMS_BASE_URL or RMS_BASE_URL"),
    check("rams_api_key", !ramsEnabled || any(env, ["RAMS_API_KEY", "RMS_API_KEY"]), "RAMS_API_KEY or RMS_API_KEY"),
    check("rams_completion_wait", !ramsEnabled || waitForRams, "RAMS_WAIT_FOR_COMPLETION=true"),
  ];

  const missing = checks.filter((item) => !item.ok).map((item) => item.detail);
  return {
    ready: missing.length === 0,
    status: missing.length === 0 ? "ready" : "misconfigured",
    ramsEnabled,
    waitForRams,
    ramsBaseUrl,
    checks,
    missing,
  };
}

export function assertWebsiteAuditReady(env = process.env) {
  const readiness = getWebsiteAuditReadiness(env);
  if (!readiness.ready) {
    const error = new Error(`Website audit is not ready: ${readiness.missing.join(", ")}`);
    error.statusCode = 503;
    error.readiness = readiness;
    throw error;
  }
  return readiness;
}

export default { getWebsiteAuditReadiness, assertWebsiteAuditReady };
