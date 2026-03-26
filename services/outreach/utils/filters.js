// services/outreach/utils/filters.js

/**
 * Outreach scoring thresholds
 * These are policy-level controls and are env-driven.
 *
 * Keep validation lazy so the whole application can boot even when
 * outreach-specific configuration is absent.
 */
function readNumericEnv(name) {
  const raw = process.env[name];

  if (raw === undefined || String(raw).trim() === "") {
    throw new Error(`${name} is required for outreach lead filtering`);
  }

  const value = Number(raw);
  if (Number.isNaN(value)) {
    throw new Error(`${name} must be a number`);
  }

  return value;
}

/**
 * Filters and scores outreach leads
 */
export function extractGoodLeads(results = [], keyword) {
  const MIN_LEAD_SCORE = readNumericEnv("OUTREACH_MIN_LEAD_SCORE");
  const MIN_EMAIL_SCORE = readNumericEnv("OUTREACH_MIN_EMAIL_SCORE");
  const now = new Date().toISOString();

  return results
    .map((r) => {
      const leadScore =
        (r.da || 0) +
        (r.serpPosition ? Math.max(0, 10 - r.serpPosition) : 0);

      return {
        timestamp: now,
        keyword,
        domain: r.domain,
        da: r.da,
        serpPosition: r.serpPosition,
        email: r.email,
        emailScore: r.emailScore,
        leadScore,
      };
    })
    .filter(
      (r) =>
        r.leadScore >= MIN_LEAD_SCORE &&
        r.emailScore >= MIN_EMAIL_SCORE
    );
}
