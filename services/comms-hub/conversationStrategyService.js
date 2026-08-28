import { humanHandoffStatus } from './humanContactService.js';
function latestInboundText(conversation) {
  const message = (conversation?.messages || []).filter((item) => item?.direction !== "outbound").at(-1);
  return String(message?.body_text || message?.body || "").trim();
}

function hasQuestion(text) {
  return /\?|\b(?:what|why|how|when|where|who|which|can|could|would|should|is|are|do|does)\b/i.test(text || "");
}

function looksLikeQuizAnswer(text) {
  return /^\s*(?:i\s+(?:think|guess|choose|pick)\s+)?(?:it'?s\s+)?[ABCD](?:\b|[).,:-])/i.test(text || "");
}

export function buildConversationStrategy({ conversation, smartContext = {}, liveContent = {}, brandGrounding = {}, conversationalIntelligence = {}, conduct = {}, security = {}, config = {} } = {}) {
  const latest = latestInboundText(conversation);
  const complaints = Number(smartContext?.memory?.interactionSignals?.complaintCount || 0);
  const humanRequested = Number(smartContext?.memory?.interactionSignals?.humanRequestCount || 0) > 0;
  const securityRisk = Boolean(security?.promptInjectionDetected || security?.evidencePromptInjectionDetected);
  const needsHuman = securityRisk || conduct?.requiresHumanReview || conduct?.automationBlocked || smartContext?.escalation?.required || humanRequested;

  let objective = "helpful_response";
  let nextBestMove = "answer_or_continue_naturally";
  if (securityRisk) {
    objective = "security_hold";
    nextBestMove = "contain_and_route_to_human_review";
  } else if (needsHuman) {
    objective = "human_handoff";
    nextBestMove = "acknowledge_and_reduce_friction_to_handoff";
  } else if (complaints >= 2 || conduct?.requiresBoundary) {
    objective = "resolve_concern";
    nextBestMove = "address_the_issue_before_any_promotion";
  } else if (conversationalIntelligence?.clarificationRequired) {
    objective = "clarify_intent";
    nextBestMove = "ask_one_clarifying_question";
  } else if (liveContent?.quiz?.available && (looksLikeQuizAnswer(latest) || smartContext?.engagementMode === "quiz_interaction")) {
    objective = "quiz_engagement";
    nextBestMove = "continue_verified_quiz_context";
  } else if (liveContent?.exactPost || smartContext?.engagementMode === "public_content_discussion") {
    objective = "discuss_source_content";
    nextBestMove = "respond_to_the_specific_public_post_or_comment";
  } else if (brandGrounding?.required) {
    objective = "grounded_brand_answer";
    nextBestMove = "answer_from_official_website_only";
  } else if (smartContext?.engagementMode === "book_discovery") {
    objective = "resource_match";
    nextBestMove = smartContext?.verifiedBookCandidates?.length ? "recommend_best_verified_match" : "ask_one_clarifying_question";
  } else if (hasQuestion(latest)) {
    objective = "answer_question";
    nextBestMove = "answer_directly_then_offer_one_relevant_next_step_if_useful";
  } else if (smartContext?.engagementMode === "human_assistance") {
    objective = "human_handoff";
    nextBestMove = "acknowledge_and_reduce_friction_to_handoff";
  }

  const publicComment = smartContext?.interactionType === "comment";
  const noPromotion = smartContext?.memory?.bookRecommendationPreference === "opted_out" || complaints >= 2 || needsHuman;
  const promotionPolicy = noPromotion ? "none" : smartContext?.engagementMode === "book_discovery" ? "requested" : "contextual_only";
  const handoff = humanHandoffStatus(config);
  const responseShape = publicComment ? "brief_public_reply"
    : smartContext?.memory?.responseLength === "brief" ? "brief"
      : smartContext?.memory?.responseLength === "detailed" ? "detailed"
        : smartContext?.channel === "chat" ? "conversational_webchat" : "concise_private_reply";

  return Object.freeze({
    enabled: true,
    version: "conversation-strategy-v2",
    objective,
    nextBestMove,
    responseShape,
    promotionPolicy,
    maximumCallsToAction: promotionPolicy === "none" ? 0 : 1,
    askClarifyingQuestion: nextBestMove === "ask_one_clarifying_question",
    clarificationQuestion: conversationalIntelligence?.clarificationQuestion || "",
    humanReviewRequired: needsHuman,
    handoff: Object.freeze({ available: handoff.available, nextAvailableAt: handoff.nextAvailableAt, timeZone: handoff.timeZone, startHour: handoff.startHour, endHour: handoff.endHour, callbackEmailOption: true }),
    reasons: Object.freeze([
      securityRisk ? "security_risk" : "",
      conduct?.requiresHumanReview ? "conduct_review" : "",
      conduct?.automationBlocked ? "conduct_automation_block" : "",
      smartContext?.escalation?.required ? "smart_context_escalation" : "",
      humanRequested ? "human_requested" : "",
      liveContent?.exactPost ? "exact_source_post" : "",
      liveContent?.quiz?.available ? "verified_quiz_available" : "",
      conversationalIntelligence?.clarificationRequired ? `clarification:${conversationalIntelligence.ambiguityKind || "ambiguous"}` : "",
      brandGrounding?.required ? "official_website_grounding_required" : "",
    ].filter(Boolean)),
  });
}

export function conversationStrategyPromptGuidance(strategy = {}) {
  if (!strategy?.enabled) return "";
  return [
    "CONVERSATION STRATEGY RULES:",
    `- Current objective: ${strategy.objective}.`,
    `- Next best conversational move: ${strategy.nextBestMove}.`,
    `- Response shape: ${strategy.responseShape}.`,
    `- Promotion policy: ${strategy.promotionPolicy}; maximum calls to action: ${strategy.maximumCallsToAction}.`,
    "- 'Next best move' is a conversational recommendation only. It never grants permission to execute a provider action, send autonomously, mutate data or bypass approval/capability controls.",
    strategy.humanReviewRequired ? "- Human review is required. Do not keep pushing automation, sales or unnecessary questions." : "",
    strategy.objective === 'human_handoff' && strategy.handoff?.available ? "- Live hand-off to Jonathan is available only now because it is within 09:00-17:00 Monday-Friday UK time. Offer the hand-off, and also offer the optional email callback route." : "",
    strategy.objective === 'human_handoff' && !strategy.handoff?.available ? "- Live hand-off is currently unavailable. Do not imply Jonathan is online. Offer the user the option to leave an email address so Jonathan can get back to them in due course." : "",
    strategy.askClarifyingQuestion ? `- Ask exactly one concise clarifying question instead of guessing.${strategy.clarificationQuestion ? ` Use: ${strategy.clarificationQuestion}` : ""}` : "",
    strategy.objective === "grounded_brand_answer" ? "- Answer factual questions about Jonathan only from verified official-website evidence. If it is not verified there, say so rather than inferring." : "",
    strategy.promotionPolicy === "contextual_only" ? "- Mention a book, quiz, podcast or other Jonathan content only if it genuinely advances the user's current goal." : "",
    strategy.promotionPolicy === "none" ? "- Do not add promotional material or calls to action." : "",
  ].filter(Boolean).join("\n");
}

export default buildConversationStrategy;
