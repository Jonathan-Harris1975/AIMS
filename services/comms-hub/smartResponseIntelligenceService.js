import { decideConversationJotform } from "./formOrchestrationService.js";
import { assessConversationBusinessRisk } from "./conversationConductService.js";

function clamp(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function autoSendEnabledForChannel(config = {}, channel = "") {
  if (config.autoSendEnabled === false) return false;
  const selected = String(channel || "").toLowerCase();
  if (selected === "chat") return config.autoSendChatEnabled !== false;
  if (selected === "email") return config.autoSendEmailEnabled !== false;
  if (selected === "form") return config.autoSendFormEnabled !== false;
  if (["facebook", "instagram", "youtube", "linkedin", "tiktok", "x", "threads"].includes(selected)) return config.autoSendSocialEnabled !== false;
  return true;
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
  conversationalIntelligence = {},
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
  const businessRisk = assessConversationBusinessRisk(conversation);
  const channelAutoSendEnabled = autoSendEnabledForChannel(config, conversation?.channel);
  const humanReview = Boolean(securityBlocked || businessRisk.requiresHumanReview || conduct.requiresHumanReview || conduct.automationBlocked || strategy.humanReviewRequired ||
     smartContext.escalation?.required);
  const evidenceRequired = Boolean(policy.requiresEvidence);
  const hasEvidence = Array.isArray(evidence) && evidence.length > 0;
  const unresolvedCount = Array.isArray(summary?.unresolvedActions) ? summary.unresolvedActions.length : 0;
  const ambiguousIntent = clamp(intent?.confidence) < 0.58 || ["unknown"].includes(String(intent?.intent || ""));
  const deterministicClarification = Boolean(conversationalIntelligence?.clarificationRequired);
  const deterministicResponse = ["assistant_identity", "assistant_capabilities"].includes(String(conversationalIntelligence?.deterministicResponseKind || ""));
  const strategyClarification = Boolean(strategy?.askClarifyingQuestion);
  // Clarification is driven by deterministic conversation/strategy state rather than
  // model confidence alone. A low triage confidence score must not make a clear
  // visitor question disappear into an unsent clarification loop.
  const clarificationRequired = !humanReview && (deterministicClarification || strategyClarification || linkPreferenceBlocksForm);

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

  const safeClarificationEligible = clarificationRequired
    && !humanReview
    && !securityBlocked
    && Number(moderation?.severity || 0) < 0.2;
  const safeDeterministicResponseEligible = deterministicResponse
    && !humanReview
    && !securityBlocked
    && Number(moderation?.severity || 0) < 0.2;
  const safeFormDeliveryEligible = Boolean(formDecision.selected)
    && !formDecision.withholdUrl
    && !humanReview
    && !securityBlocked
    && Number(moderation?.severity || 0) < 0.2;
  const autonomousEligible = channelAutoSendEnabled
    && !humanReview
    && !clarificationRequired
    && (safeFormDeliveryEligible || clamp(intent?.confidence) >= Number(config.smartResponseMinimumConfidence ?? 0.86))
    && (!evidenceRequired || hasEvidence || safeFormDeliveryEligible)
    && Number(moderation?.severity || 0) < 0.2;

  return Object.freeze({
    enabled: config.smartResponseEnabled !== false,
    version: "smart-response/v3",
    confidence: Number(score.toFixed(3)),
    confidenceBand: level(score),
    answerability,
    clarificationRequired,
    humanReviewRequired: humanReview,
    autonomousEligible,
    channelAutoSendEnabled,
    businessRisk,
    safeClarificationEligible,
    safeDeterministicResponseEligible,
    safeFormDeliveryEligible,
    nextBestMove,
    formDecision,
    reasons: Object.freeze([
      ...(securityBlocked ? ["security_risk"] : []),
      ...(businessRisk.detected ? businessRisk.categories.map((category) => `business_risk:${category}`) : []),
      ...(!channelAutoSendEnabled ? ["channel_auto_send_disabled"] : []),
      ...(conduct.requiresHumanReview || conduct.automationBlocked ? ["conduct_risk"] : []),
      ...(strategy.humanReviewRequired ? ["strategy_review"] : []),
      ...(smartContext.escalation?.required ? ["context_escalation"] : []),
      ...(deterministicClarification ? [`conversation_ambiguous:${conversationalIntelligence?.ambiguityKind || "unknown"}`] : []),
      ...(strategyClarification && !deterministicClarification ? ["strategy_clarification"] : []),
      ...(safeClarificationEligible ? ["safe_deterministic_clarification"] : []),
      ...(safeDeterministicResponseEligible ? [`safe_deterministic_response:${conversationalIntelligence?.deterministicResponseKind}`] : []),
      ...(safeFormDeliveryEligible ? [`safe_form_delivery:${formDecision.formKey}`] : []),
      ...(ambiguousIntent && !safeFormDeliveryEligible ? ["intent_ambiguous"] : []),
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
