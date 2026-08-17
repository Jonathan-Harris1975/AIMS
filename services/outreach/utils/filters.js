// services/outreach/utils/filters.js

import { resolveOutreachThresholds } from "../config.js";

export function emailValidationScore(validation = {}) {
  const status = String(validation?.status || "unknown").toLowerCase();
  if (status === "valid") return 1;
  if (["catch-all", "catch_all"].includes(status)) return 0.65;
  if (status === "unknown") return 0.15;
  return 0;
}

/** Filters and scores outreach leads using the active production/test policy. */
export function extractGoodLeads(results = [], keyword, env = process.env) {
  const thresholds = resolveOutreachThresholds(env);
  const now = new Date().toISOString();
  return results.map((r) => {
    const leadScore = (r.da || 0) + (r.serpPosition ? Math.max(0, 10 - r.serpPosition) : 0);
    const validation = r.validation || r.emailValidation || {};
    const emailScore = Number.isFinite(Number(r.emailScore)) && Number(r.emailScore) > 0 ? Number(r.emailScore) : emailValidationScore(validation);
    return {
      timestamp: now, keyword, domain: r.domain, da: r.da, serpPosition: r.serpPosition,
      email: r.email, emailScore, validation, contact: r.contact || r.hunter || null, leadScore,
      sourceUrl: r.sourceUrl || null, sourceTitle: r.sourceTitle || null, sourceSnippet: r.sourceSnippet || null,
      editorialSurface: Boolean(r.editorialSurface),
    };
  }).filter((r) => r.leadScore >= thresholds.minLeadScore && r.emailScore >= thresholds.minEmailScore);
}
