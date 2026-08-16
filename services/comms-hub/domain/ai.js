import { CommsHubError } from "../errors.js";
import { sha256Hex } from "./ids.js";

export const COMMS_HUB_INTENTS = Object.freeze([
  "general_enquiry",
  "case_study_contribution",
  "podcast_contribution",
  "support_request",
  "commercial_enquiry",
  "complaint",
  "social_engagement",
  "spam",
  "unknown",
]);

export const MODERATION_LABELS = Object.freeze([
  "none",
  "spam",
  "scam",
  "hostility",
  "harassment",
  "hate",
  "sexual",
  "violence",
  "self_harm",
  "personal_data",
  "malicious_link",
]);

export const REPLY_POLICIES = Object.freeze({
  contact_intake: Object.freeze({
    key: "contact",
    purpose: "Answer contact enquiries clearly and route unsupported requests for review.",
    maximumCharacters: 2200,
    requiresEvidence: true,
    defaultFollowUpHours: 48,
    modelRoute: "commsHubDraftContact",
  }),
  case_study_intake: Object.freeze({
    key: "contribute",
    purpose: "Acknowledge a case-study contribution, identify missing evidence, and explain the next automated step.",
    maximumCharacters: 2600,
    requiresEvidence: true,
    defaultFollowUpHours: 72,
    modelRoute: "commsHubDraftContribute",
  }),
  podcast_enquiry_intake: Object.freeze({
    key: "podcast",
    purpose: "Manage the automated podcast contribution journey without offering guest booking slots.",
    maximumCharacters: 2600,
    requiresEvidence: true,
    defaultFollowUpHours: 72,
    modelRoute: "commsHubDraftPodcast",
  }),
  social_inbox: Object.freeze({
    key: "social_dm",
    purpose: "Reply conversationally to a social direct message while protecting privacy and avoiding unsupported promises.",
    maximumCharacters: 1800,
    requiresEvidence: false,
    defaultFollowUpHours: 48,
    modelRoute: "commsHubDraftSocial",
  }),
  social_comment_moderation: Object.freeze({
    key: "social_comment",
    purpose: "Reply briefly to a public comment or recommend a supported moderation action.",
    maximumCharacters: 900,
    requiresEvidence: false,
    defaultFollowUpHours: 24,
    modelRoute: "commsHubDraftSocial",
  }),
});

export const MODERATION_CAPABILITIES = Object.freeze({
  facebook: Object.freeze({ hide: true, unhide: true, delete: true, moderate: false, block: false, escalate: true, banAuthor: false }),
  instagram: Object.freeze({ hide: true, unhide: true, delete: true, moderate: false, block: false, escalate: true, banAuthor: false }),
  youtube: Object.freeze({ hide: false, unhide: false, delete: true, moderate: true, block: false, escalate: true, banAuthor: true }),
});

const INTENT_WORKFLOW_MAP = Object.freeze({
  case_study_contribution: "case_study_intake",
  podcast_contribution: "podcast_enquiry_intake",
  general_enquiry: "contact_intake",
  support_request: "contact_intake",
  commercial_enquiry: "contact_intake",
  complaint: "contact_intake",
});

function text(value, max = 10_000) {
  return String(value ?? "").trim().slice(0, max);
}

export function clampNumber(value, minimum, maximum, fallback = minimum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

export function parseStrictJson(value, label = "AI response") {
  const raw = text(value, 200_000);
  const withoutFence = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    const parsed = JSON.parse(withoutFence);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON object required");
    return parsed;
  } catch (cause) {
    throw new CommsHubError(502, "ai_response_invalid", `${label} was not a valid JSON object.`, {
      cause,
      failureClass: "recoverable",
      publicMessage: "The AI response could not be validated.",
    });
  }
}

export function normaliseIntentResult(value = {}) {
  const intent = COMMS_HUB_INTENTS.includes(value.intent) ? value.intent : "unknown";
  return Object.freeze({
    intent,
    confidence: clampNumber(value.confidence, 0, 1, 0),
    urgency: clampNumber(value.urgency, 0, 1, 0),
    commercialValue: clampNumber(value.commercialValue, 0, 1, 0),
    reputationalRisk: clampNumber(value.reputationalRisk, 0, 1, 0),
    customerImpact: clampNumber(value.customerImpact, 0, 1, 0),
    rationale: text(value.rationale, 1000),
  });
}

export function calculatePriority(result, { workflow = "", channel = "" } = {}) {
  const factors = Object.freeze({
    urgency: Object.freeze({ value: result.urgency, weight: 35, contribution: result.urgency * 35 }),
    customerImpact: Object.freeze({ value: result.customerImpact, weight: 25, contribution: result.customerImpact * 25 }),
    reputationalRisk: Object.freeze({ value: result.reputationalRisk, weight: 25, contribution: result.reputationalRisk * 25 }),
    commercialValue: Object.freeze({ value: result.commercialValue, weight: 15, contribution: result.commercialValue * 15 }),
  });
  const base = Object.values(factors).reduce((sum, factor) => sum + factor.contribution, 0);
  let override = 0;
  const reasons = [];
  if (result.intent === "complaint") { override += 15; reasons.push("complaint"); }
  if (result.intent === "support_request" && result.urgency >= 0.75) { override += 10; reasons.push("urgent_support"); }
  if (workflow === "podcast_enquiry_intake" && result.intent === "podcast_contribution") { override += 5; reasons.push("podcast_workflow"); }
  if (channel === "social" && result.reputationalRisk >= 0.7) { override += 10; reasons.push("public_reputation"); }
  const score = Math.round(clampNumber(base + override, 0, 100, 0));
  const label = priorityLabelForScore(score);
  return Object.freeze({ score, label, baseScore: Math.round(base), factors, overrideReasons: Object.freeze(reasons) });
}

export function priorityLabelForScore(score) {
  const value = Math.round(clampNumber(score, 0, 100, 0));
  return value >= 80 ? "critical" : value >= 60 ? "high" : value >= 35 ? "normal" : "low";
}

export function normalisePriorityOverride(value = {}) {
  const score = Math.round(clampNumber(value.score, 0, 100, -1));
  if (score < 0) throw new CommsHubError(400, "priority_override_invalid", "Priority override score must be between 0 and 100.");
  const reason = text(value.reason, 1000);
  if (!reason) throw new CommsHubError(400, "priority_override_reason_required", "Priority override reason is required.");
  return Object.freeze({ score, label: priorityLabelForScore(score), reason });
}

export function selectWorkflow({ intent, channel, currentWorkflow }) {
  let selectedWorkflow;
  if (channel === "social") {
    selectedWorkflow = currentWorkflow === "social_comment_moderation" ? "social_comment_moderation" : "social_inbox";
  } else {
    selectedWorkflow = INTENT_WORKFLOW_MAP[intent] || currentWorkflow || "contact_intake";
  }
  const mismatch = Boolean(currentWorkflow && selectedWorkflow !== currentWorkflow);
  return Object.freeze({
    selectedWorkflow,
    currentWorkflow: currentWorkflow || null,
    mismatch,
    rationale: mismatch
      ? `Intent '${intent}' maps to '${selectedWorkflow}', not the current '${currentWorkflow}' workflow.`
      : `Intent '${intent}' is consistent with '${selectedWorkflow}'.`,
  });
}

export function normaliseModerationResult(value = {}) {
  const abuseLabel = MODERATION_LABELS.includes(value.abuseLabel) ? value.abuseLabel : "none";
  const sentiment = ["positive", "neutral", "negative", "mixed"].includes(value.sentiment) ? value.sentiment : "neutral";
  const confidence = clampNumber(value.confidence, 0, 1, 0);
  const severity = clampNumber(value.severity, 0, 1, 0);
  const riskLevel = severity >= 0.8 || ["hate", "violence", "self_harm"].includes(abuseLabel)
    ? "critical"
    : severity >= 0.55 || abuseLabel !== "none" ? "high"
      : severity >= 0.25 ? "medium" : "low";
  return Object.freeze({
    sentiment,
    abuseLabel,
    confidence,
    severity,
    riskLevel,
    rationale: text(value.rationale, 1000),
    recommendedAction: text(value.recommendedAction, 100),
  });
}

export function policyForWorkflow(workflow) {
  const policy = REPLY_POLICIES[workflow];
  if (!policy) {
    throw new CommsHubError(422, "reply_policy_missing", `No reply policy is configured for workflow '${workflow}'.`, {
      failureClass: "permanent",
      publicMessage: "This conversation workflow is not enabled for AI replies.",
    });
  }
  return policy;
}

export function requiresHumanApproval({
  moderation,
  priority,
  actionType = "reply",
  hasEvidence = true,
  policy,
  severityThreshold = 0.2,
  priorityScoreThreshold = 60,
  workflowMismatch = false,
  intent = "unknown",
  securityRisk = false,
}) {
  const reasons = [];
  if (moderation.severity >= severityThreshold || ["high", "critical"].includes(moderation.riskLevel)) reasons.push("moderation_risk");
  if (priority.score >= priorityScoreThreshold) reasons.push("priority_risk");
  if (["delete", "hide", "moderate", "ban_author", "escalate"].includes(actionType)) reasons.push("destructive_or_moderation_action");
  if (policy?.requiresEvidence && !hasEvidence) reasons.push("evidence_missing");
  if (workflowMismatch) reasons.push("workflow_mismatch");
  if (intent === "spam") reasons.push("spam_intent");
  if (securityRisk) reasons.push("prompt_injection_or_poisoned_context");
  return Object.freeze({ required: reasons.length > 0, reasons: Object.freeze(reasons) });
}

export function assertSupportedModerationAction({ platform, action, body = {} }) {
  const capability = MODERATION_CAPABILITIES[platform];
  if (!capability || capability[action] !== true) {
    throw new CommsHubError(422, "moderation_capability_unsupported", `${action} is not supported for ${platform}.`, {
      failureClass: "permanent",
      publicMessage: "That moderation action is not supported on this channel.",
    });
  }
  if (body.banAuthor === true && capability.banAuthor !== true) {
    throw new CommsHubError(422, "moderation_ban_unsupported", `Author banning is not supported for ${platform}.`);
  }
  return capability;
}

export function approvalScopeHash({ targetType, targetId, actionType, payload }) {
  return sha256Hex(JSON.stringify({ targetType, targetId, actionType, payload }));
}

export function normaliseSummary(value = {}, allowedMessageIds = []) {
  const allowed = new Set(allowedMessageIds);
  const sourceMessageIds = Array.isArray(value.sourceMessageIds)
    ? value.sourceMessageIds.map((item) => text(item, 100)).filter((item) => allowed.has(item))
    : [];
  const unresolvedActions = Array.isArray(value.unresolvedActions)
    ? value.unresolvedActions.map((item) => text(item, 500)).filter(Boolean).slice(0, 10)
    : [];
  return Object.freeze({
    summary: text(value.summary, 4000),
    unresolvedActions: Object.freeze(unresolvedActions),
    sourceMessageIds: Object.freeze([...new Set(sourceMessageIds)]),
    nextAction: text(value.nextAction, 500),
    followUpNeeded: value.followUpNeeded === true,
    followUpReason: text(value.followUpReason, 500),
    followUpHours: Math.round(clampNumber(value.followUpHours, 1, 720, 72)),
  });
}

export function validateDraft(value, policy, evidenceIds = []) {
  const bodyText = text(value?.bodyText, policy.maximumCharacters + 1);
  if (!bodyText || bodyText.length > policy.maximumCharacters) {
    throw new CommsHubError(422, "reply_draft_invalid", `Reply draft must contain 1-${policy.maximumCharacters} characters.`, {
      failureClass: "recoverable",
      publicMessage: "The reply draft did not pass validation.",
    });
  }
  if (policy.requiresEvidence && evidenceIds.length === 0) {
    throw new CommsHubError(422, "reply_evidence_required", "Knowledge-grounded replies require at least one approved evidence source.", {
      failureClass: "recoverable",
      publicMessage: "The reply needs supporting evidence before it can be used.",
    });
  }
  return bodyText;
}
