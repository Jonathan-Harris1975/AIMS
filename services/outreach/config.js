function numberEnv(env, name, fallback) {
  const raw = env?.[name];
  if (raw === undefined || String(raw).trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number`);
  return value;
}

function booleanEnv(value, fallback = false) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

export function resolveOutreachThresholds(env = process.env) {
  const testMode = booleanEnv(env.OUTREACH_TEST_MODE, false);
  if (testMode) {
    return {
      testMode: true,
      minAuthorityScore: numberEnv(env, "OUTREACH_TEST_MIN_AUTHORITY_SCORE", 8),
      minLeadScore: numberEnv(env, "OUTREACH_TEST_MIN_LEAD_SCORE", 10),
      minEmailScore: numberEnv(env, "OUTREACH_TEST_MIN_EMAIL_SCORE", 0.2),
    };
  }

  return {
    testMode: false,
    minAuthorityScore: numberEnv(env, "OUTREACH_MIN_AUTHORITY_SCORE", 14),
    minLeadScore: numberEnv(env, "OUTREACH_MIN_LEAD_SCORE", 18),
    minEmailScore: numberEnv(env, "OUTREACH_MIN_EMAIL_SCORE", 0.5),
  };
}

export function outreachLeadPrefix(env = process.env) {
  return String(env.OUTREACH_R2_PREFIX || "outreach/leads")
    .trim()
    .replace(/^\/+|\/+$/g, "") || "outreach/leads";
}
