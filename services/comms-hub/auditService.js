import { stableId, sha256Hex, newCorrelationId } from "./domain/ids.js";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function hash(value) {
  return value === undefined ? null : sha256Hex(JSON.stringify(canonical(value)));
}

export class CommsHubAuditService {
  constructor({ repository }) {
    this.repository = repository;
  }

  async record({ actor, role, action, objectType, objectId = null, conversationId = null, requestId = null, outcome = "success", before, after, details = {}, occurredAt = new Date().toISOString() }) {
    return this.repository.recordAuditEvent({
      id: stableId("aud", occurredAt, actor, action, objectType, objectId || "", requestId || "", newCorrelationId()),
      occurredAt,
      actor,
      actorRole: role,
      action,
      objectType,
      objectId,
      conversationId,
      requestId,
      outcome,
      beforeSha256: hash(before),
      afterSha256: hash(after),
      details,
    });
  }

  async list(filters) {
    return this.repository.listAuditEvents(filters);
  }
}

export default CommsHubAuditService;
