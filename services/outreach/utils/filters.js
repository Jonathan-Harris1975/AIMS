// services/outreach/utils/filters.js

import { resolveOutreachThresholds } from "../config.js";

/**
 * Filters and scores outreach leads using the active production/test policy.
 */
export function extractGoodLeads(results = [], keyword, env = process.env) {
  const thresholds = resolveOutreachThresholds(env);
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
        r.leadScore >= thresholds.minLeadScore &&
        r.emailScore >= thresholds.minEmailScore
    );
}
