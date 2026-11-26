// services/outreach/utils/filters.js

import { resolveOutreachThresholds } from "../config.js";
import { OUTREACH_QUALIFICATION_THRESHOLD } from "./qualification.js";

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
    const legacyLeadScore = (r.da || 0) + (r.serpPosition ? Math.max(0, 10 - r.serpPosition) : 0);
    const leadScore = Number.isFinite(Number(r.opportunityScore)) ? Number(r.opportunityScore) : legacyLeadScore;
    const validation = r.validation || r.emailValidation || {};
    const emailScore = Number.isFinite(Number(r.emailScore)) && Number(r.emailScore) > 0 ? Number(r.emailScore) : emailValidationScore(validation);
    return {
      timestamp: now, keyword, domain: r.domain, da: r.da, serpPosition: r.serpPosition,
      email: r.email, emailScore, validation, contact: r.contact || r.hunter || null, leadScore,
      sourceUrl: r.sourceUrl || null, sourceTitle: r.sourceTitle || null, sourceSnippet: r.sourceSnippet || null,
      editorialSurface: Boolean(r.editorialSurface), editorialEvidence: r.editorialEvidence || null,
      qualification: r.qualification || null, contactType: r.contactType || null,
    };
  }).filter((r) => {
    const scorePass = r.qualification ? r.qualification.qualified && r.leadScore >= OUTREACH_QUALIFICATION_THRESHOLD : r.leadScore >= thresholds.minLeadScore;
    return scorePass && r.emailScore >= thresholds.minEmailScore;
  });
}
