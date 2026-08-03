function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function buildAuditPrefix(auditType, sessionId, date = new Date()) {
  return `audits/${auditType}/${timestampSlug(date)}-${sessionId}`;
}

export function buildLatestKey(auditType) {
  return `audits/${auditType}/latest.json`;
}

export function makeAuditJobType(auditType) {
  return `audit:${auditType}`;
}

const WEBSITE_PIPELINE_STAGE_LEAVES = Object.freeze({
  "digital-growth": "digital-growth",
  "seo-aeo-geo": "seo-aeo-geo",
  "mobile-ux": "mobile-ux",
});

export function inferWebsitePipelineSessionIdFromPrefix(reportPrefix, auditType) {
  const value = String(reportPrefix || "").trim().replace(/\/+$/, "");
  const expectedLeaf = WEBSITE_PIPELINE_STAGE_LEAVES[String(auditType || "").trim()];
  if (!value || !expectedLeaf) return null;

  const match = value.match(/^audits\/_tmp\/website\/([^/]+)\/([^/]+)$/);
  if (!match || match[2] !== expectedLeaf) return null;
  return match[1] || null;
}

export default {
  buildAuditPrefix,
  buildLatestKey,
  makeAuditJobType,
  inferWebsitePipelineSessionIdFromPrefix,
};
