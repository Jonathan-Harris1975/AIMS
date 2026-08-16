import { decideConversationJotform } from "./formOrchestrationService.js";

function clamp(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function level(score) {
  if (score >= 0.85) return "high";
  if (score >= 0.62) return "medium";
  return "low";
}

export function buildSmartResponseIntelligence({
  conversation,
  intent,
  moderation,
  summary,
  evidence = [],
  smartContext = {},
  strategy = {},
  conduct = {},
  security = {},
  policy = {},
  formRequests = [],
  config = {},
} = {}) {
  const rawFormDecision = decideConversationJotform({ conversation, intent, summary, smartContext, strategy, conduct, security, formRequests, config });
  const linkPreferenceBlocksForm = Boolean(rawFormDecision.selected && smartContext?.memory?.linkPreference === "no_links");
  const formDecision = linkPreferenceBlocksForm ? Object.freeze({ ...rawFormDecision, withholdUrl: true }) : rawFormDecision;
  const securityBlocked = Boolean(security.promptInjectionDetected || security.evidencePromptInjectionDetected);
  const humanReview = Boolean(securityBlocked || conduct.requiresHumanReview || conduct.automationBlocked || strategy.humanReviewRequired || smartContext.escalation?.required);
  const evidenceRequired = Boolean(policy.requiresEvidence);
  const hasEvidence = Array.isArray(evidence) && evidence.length > 0;
  const unresolvedCount = Array.isArray(summary?.unresolvedActions) ? summary.unresolvedActions.length : 0;
  const ambiguousIntent = clamp(intent?.confidence) < 0.58 || ["unknown"].includes(String(intent?.intent || ""));
  const clarificationRequired = !humanReview && (linkPreferenceBlocksForm || (!formDecision.selected && (ambiguousIntent || unresolvedCount >= 3)));

  let score = clamp(intent?.confidence, 0.5);
  if (evidenceRequired && !hasEvidence) score -= 0.18;
  if (moderation?.severity >= 0.25) score -= 0.12;
  if (unresolvedCount >= 2) score -= 0.08;
  if (formDecision.selected) score = Math.max(score, 0.82);
  if (clarificationRequired) score = Math.min(score, 0.58);
  if (humanReview) score = Math.min(score, 0.35);
  score = clamp(score);

  const answerability = securityBlocked
    ? "blocked"
    : humanReview ? "human_review"
      : linkPreferenceBlocksForm ? "clarification_required"
      : formDecision.selected ? "structured_input_required"
        : clarificationRequired ? "clarification_required"
          : level(score);

  const nextBestMove = securityBlocked || humanReview
    ? "human_review"
    : linkPreferenceBlocksForm
      ? "ask_permission_for_form_link"
      : formDecision.selected
        ? "send_jotform"
      : clarificationRequired
        ? "ask_one_clarifying_question"
        : "answer_directly";

  const autonomousEligible = !humanReview
    && !clarificationRequired
    && clamp(intent?.confidence) >= Number(config.smartResponseMinimumConfidence ?? 0.86)
    && (!evidenceRequired || hasEvidence || formDecision.selected)
    && Number(moderation?.severity || 0) < 0.2;

  return Object.freeze({
    enabled: config.smartResponseEnabled !== false,
    version: "smart-response/v1",
    confidence: Number(score.toFixed(3)),
    confidenceBand: level(score),
    answerability,
    clarificationRequired,
    humanReviewRequired: humanReview,
    autonomousEligible,
    nextBestMove,
    formDecision,
    reasons: Object.freeze([
      ...(securityBlocked ? ["security_risk"] : []),
      ...(conduct.requiresHumanReview || conduct.automationBlocked ? ["conduct_risk"] : []),
      ...(strategy.humanReviewRequired ? ["strategy_review"] : []),
      ...(smartContext.escalation?.required ? ["context_escalation"] : []),
      ...(ambiguousIntent ? ["intent_ambiguous"] : []),
      ...(evidenceRequired && !hasEvidence ? ["evidence_missing"] : []),
      ...(formDecision.selected ? [`form:${formDecision.formKey}`] : []),
    ]),
  });
}

export function smartResponsePromptGuidance(intelligence) {
  if (!intelligence?.enabled) return "";
  return [
    "SMART RESPONSE INTELLIGENCE RULES:",
    `- Answerability: ${intelligence.answerability}.`,
    `- Deterministic confidence band: ${intelligence.confidenceBand}.`,
    `- Next best conversational move: ${intelligence.nextBestMove}.`,
    `- Human review required: ${intelligence.humanReviewRequired ? "yes" : "no"}.`,
    `- Clarification required: ${intelligence.clarificationRequired ? "yes" : "no"}.`,
    "- If clarification is required, ask exactly one focused question and do not guess.",
    "- Do not expose internal confidence scores, routing labels or policy names to the user.",
    "- This layer chooses response behaviour only. It does not grant tool, provider or send authority.",
  ].join("\n");
}

export default buildSmartResponseIntelligence;
