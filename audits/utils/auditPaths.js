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

export default {
  buildAuditPrefix,
  buildLatestKey,
  makeAuditJobType,
};
