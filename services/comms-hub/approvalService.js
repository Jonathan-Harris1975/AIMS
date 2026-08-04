import { stableId } from "./domain/ids.js";
import { approvalScopeHash } from "./domain/ai.js";
import { CommsHubError } from "./errors.js";

function actor(value, fallback) {
  const text = String(value || "").trim();
  return text ? text.slice(0, 200) : fallback;
}

export function buildApprovalRequest({ conversationId, targetType, targetId, actionType, payload, riskLevel, requestedBy = "aims:comms-hub", ttlHours = 72, metadata = {} }) {
  const requestedAt = new Date().toISOString();
  const scopeSha256 = approvalScopeHash({ targetType, targetId, actionType, payload });
  return Object.freeze({
    id: stableId("apr", conversationId, targetType, targetId, actionType, scopeSha256),
    conversationId,
    targetType,
    targetId,
    actionType,
    riskLevel,
    scopeSha256,
    requestedBy: actor(requestedBy, "aims:comms-hub"),
    requestedAt,
    expiresAt: new Date(Date.parse(requestedAt) + Math.max(1, Math.min(720, Number(ttlHours) || 72)) * 3_600_000).toISOString(),
    metadata,
  });
}

export async function requestApproval({ repository, ...input }) {
  return repository.createApproval(buildApprovalRequest(input));
}

export async function decideApproval({ repository, approvalId, decision, decidedBy, reason = "" }) {
  const normalised = String(decision || "").trim().toLowerCase();
  if (!['approved', 'rejected'].includes(normalised)) {
    throw new CommsHubError(400, "approval_decision_invalid", "Approval decision must be approved or rejected.", {
      publicMessage: "Approval decision is invalid.",
    });
  }
  const reviewer = actor(decidedBy, "");
  if (!reviewer) {
    throw new CommsHubError(400, "approval_reviewer_required", "An authorised reviewer identity is required.", {
      publicMessage: "Reviewer identity is required.",
    });
  }
  return repository.decideApproval({
    id: approvalId,
    decision: normalised,
    decidedBy: reviewer,
    reason: String(reason || "").trim().slice(0, 1000),
    decidedAt: new Date().toISOString(),
  });
}

export async function requireApproval({ repository, approvalId, conversationId, targetType, targetId, actionType, payload }) {
  if (!approvalId) {
    throw new CommsHubError(403, "approval_required", "A matching approval record is required.", {
      failureClass: "permanent",
      publicMessage: "This action requires approval.",
    });
  }
  return repository.requireApproved({
    approvalId,
    conversationId,
    targetType,
    targetId,
    actionType,
    scopeSha256: approvalScopeHash({ targetType, targetId, actionType, payload }),
    now: new Date().toISOString(),
  });
}

export default { buildApprovalRequest, requestApproval, decideApproval, requireApproval };
