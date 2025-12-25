// services/outreach/utils/filters.js

import { ENV } from "../../../scripts/envBootstrap.js";

/**
 * Outreach scoring thresholds
 * These are policy-level controls and are now env-driven.
 * Behaviour is unchanged as long as env values match previous constants.
 */
const MIN_LEAD_SCORE = Number(ENV.OUTREACH_MIN_LEAD_SCORE);
const MIN_EMAIL_SCORE = Number(ENV.OUTREACH_MIN_EMAIL_SCORE);

if (Number.isNaN(MIN_LEAD_SCORE)) {
  throw new Error("OUTREACH_MIN_LEAD_SCORE must be a number");
}

if (Number.isNaN(MIN_EMAIL_SCORE)) {
  throw new Error("OUTREACH_MIN_EMAIL_SCORE must be a number");
}

/**
 * Filters and scores outreach leads
 */
export function extractGoodLeads(results = [], keyword) {
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
