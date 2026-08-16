import { stableId } from "./domain/ids.js";

const HUMAN_REVIEW_BLOCKERS = new Set(["security_hold", "human_handoff"]);

function text(value, max = 20_000) {
  return String(value ?? "").trim().slice(0, max);
}

function inboundMessages(conversation) {
  return (conversation?.messages || []).filter((message) => message?.direction !== "outbound");
}

function messageText(message, maximum = 12_000) {
  return text(`${message?.subject || ""}\n${message?.body_text || message?.body || ""}`, maximum);
}

function latestInboundText(conversation) {
  return messageText(inboundMessages(conversation).at(-1));
}

function recentInboundText(conversation, count = 4) {
  return inboundMessages(conversation)
    .slice(-Math.max(1, Number(count) || 4))
    .map((message) => messageText(message))
    .join("\n")
    .slice(-24_000);
}

function definitionFor(key, config = {}) {
  const definitions = config.jotformForms || {};
  return definitions[key] || null;
}

function formDecision(key, { reason, required = false, config = {}, source = "deterministic_intent" } = {}) {
  const definition = definitionFor(key, config);
  if (!definition?.formId || !definition?.url) return Object.freeze({ selected: false, reason: "form_not_configured" });
  return Object.freeze({
    selected: true,
    formKey: key,
    formId: definition.formId,
    formUrl: definition.url,
    label: definition.label,
    workflow: definition.workflow,
    reason,
    required,
    source,
  });
}

export function decideConversationJotform({ conversation, intent, summary, smartContext = {}, strategy = {}, conduct = {}, security = {}, formRequests = [], config = {} } = {}) {
  if (config.formOrchestrationEnabled === false) return Object.freeze({ selected: false, reason: "form_orchestration_disabled" });
  if (conversation?.channel === "form") return Object.freeze({ selected: false, reason: "already_in_form_workflow" });
  if (security?.promptInjectionDetected || security?.evidencePromptInjectionDetected || conduct?.requiresHumanReview || conduct?.automationBlocked || HUMAN_REVIEW_BLOCKERS.has(strategy?.objective)) {
    return Object.freeze({ selected: false, reason: "human_or_security_review_precedes_form" });
  }

  // Form selection is intentionally recent-message biased. Historical conversation text is
  // useful memory, but must not resurrect an old form request after the user has moved on.
  const latestBody = latestInboundText(conversation).toLowerCase();
  const recentBody = recentInboundText(conversation).toLowerCase();
  const nowMs = Date.now();
  const requests = Array.isArray(formRequests) ? formRequests : [];
  const activeRequests = requests.filter((request) => {
    if (!["sent", "submitted", "processed"].includes(String(request?.status || ""))) return false;
    const expiryMs = Date.parse(String(request?.expires_at || request?.expiresAt || ""));
    return !Number.isFinite(expiryMs) || expiryMs > nowMs || request.status !== "sent";
  });
  const alreadyActive = (key) => activeRequests.find((request) => String(request?.form_key || request?.formKey || "") === key);
  const completed = (key) => requests.find((request) => String(request?.form_key || request?.formKey || "") === key && String(request?.status || "") === "replied");
  const intentName = String(intent?.intent || "");
  const latestAction = text(summary?.nextAction, 1000).toLowerCase();

  const explicitNewCycle = /\b(?:another|new|again|resubmit|re-submit|submit again|apply again|updated form|update my (?:form|application)|fill (?:it|the form) in again)\b/i.test(latestBody);
  const explicitlyWantsForm = /\b(form|application|apply|submit|questionnaire|send (?:you )?my details|where do i send|how do i contribute)\b/i.test(latestBody);

  const podcastPattern = /\b(podcast|turing'?s torch)\b[\s\S]{0,140}\b(guest|appear|apply|contribut|interview|join|take part|be on)\b|\b(guest|appear|apply|contribut|interview|join|take part|be on)\b[\s\S]{0,140}\b(podcast|turing'?s torch)\b/i;
  const caseStudyPattern = /\b(case study|success story|share (?:my|our) experience|contribute (?:a )?(?:case|story)|project results?|implementation story)\b/i;
  const contactPattern = /\b(proposal|media enquiry|speaking enquiry|consulting brief|partnership proposal|collaboration proposal|attach(?:ment)?|send (?:a )?brief|detailed requirements)\b/i;

  const latestPodcastParticipation = podcastPattern.test(latestBody);
  const latestCaseStudy = caseStudyPattern.test(latestBody);
  const latestStructuredContact = contactPattern.test(latestBody);
  const wantsPodcastParticipation = latestPodcastParticipation
    || (!completed("podcast_enquiry") && (intentName === "podcast_contribution" || podcastPattern.test(recentBody)));
  const wantsCaseStudy = latestCaseStudy
    || (!completed("case_study") && (intentName === "case_study_contribution" || caseStudyPattern.test(recentBody)));
  const structuredContactNeeded = latestStructuredContact
    || (!completed("contact") && (contactPattern.test(recentBody) || /\bstructured (?:details|information)\b/i.test(latestAction)));

  if (wantsPodcastParticipation) {
    if (alreadyActive("podcast_enquiry")) return Object.freeze({ selected: false, reason: "form_already_active", formKey: "podcast_enquiry", activeRequest: true });
    if (completed("podcast_enquiry") && !latestPodcastParticipation && !explicitNewCycle) return Object.freeze({ selected: false, reason: "form_previously_completed_no_new_request", formKey: "podcast_enquiry" });
    return formDecision("podcast_enquiry", {
      reason: "podcast_participation_requires_structured_intake",
      required: true,
      config,
      source: completed("podcast_enquiry") ? "explicit_new_cycle" : "deterministic_intent",
    });
  }
  if (wantsCaseStudy) {
    if (alreadyActive("case_study")) return Object.freeze({ selected: false, reason: "form_already_active", formKey: "case_study", activeRequest: true });
    if (completed("case_study") && !latestCaseStudy && !explicitNewCycle) return Object.freeze({ selected: false, reason: "form_previously_completed_no_new_request", formKey: "case_study" });
    return formDecision("case_study", {
      reason: "case_study_contribution_requires_structured_intake",
      required: true,
      config,
      source: completed("case_study") ? "explicit_new_cycle" : "deterministic_intent",
    });
  }
  if (structuredContactNeeded || (explicitlyWantsForm && ["commercial_enquiry", "support_request", "general_enquiry"].includes(intentName))) {
    if (alreadyActive("contact")) return Object.freeze({ selected: false, reason: "form_already_active", formKey: "contact", activeRequest: true });
    if (completed("contact") && !latestStructuredContact && !explicitlyWantsForm && !explicitNewCycle) return Object.freeze({ selected: false, reason: "form_previously_completed_no_new_request", formKey: "contact" });
    return formDecision("contact", {
      reason: structuredContactNeeded ? "structured_contact_details_helpful" : "visitor_explicitly_requested_form",
      required: false,
      config,
      source: completed("contact") ? "explicit_new_cycle" : "deterministic_intent",
    });
  }

  return Object.freeze({ selected: false, reason: "conversation_can_continue_without_form" });
}

export function formPromptGuidance(decision) {
  if (decision?.selected && decision.withholdUrl) {
    return [
      "JOTFORM ORCHESTRATION RULES:",
      `- A ${decision.label} is the correct structured route, but the user has explicitly asked for no links.`,
      "- Do not include the form URL in this reply.",
      "- Ask one short question to confirm whether they want the form link despite that earlier preference.",
      "- Do not offer a different form or ask them to paste sensitive structured information into chat.",
    ].join("\n");
  }
  if (!decision?.selected) {
    return [
      "JOTFORM ORCHESTRATION RULES:",
      "- No Jotform has been selected for this reply.",
      "- Do not invent, guess or offer a form URL.",
      "- Continue conversationally or ask one focused clarification if needed.",
    ].join("\n");
  }
  return [
    "JOTFORM ORCHESTRATION RULES:",
    `- Selected form: ${decision.label} (${decision.formKey}).`,
    `- Exact approved form URL: ${decision.formUrl}`,
    `- Selection reason: ${decision.reason}.`,
    `- The form is ${decision.required ? "required for this structured intake" : "optional and should be offered only because it is useful here"}.`,
    "- Include the exact approved URL once, naturally, and explain briefly why the form is useful.",
    "- Do not imply that submitting a form guarantees acceptance, publication, booking, collaboration or any outcome.",
    "- Do not ask the user to paste sensitive information into chat when the selected form is the safer structured route.",
    "- Do not offer a different form.",
  ].join("\n");
}

export function buildFormRequestRecord({ conversation, draftId, decision, sentAt = new Date().toISOString(), expiryHours = 336 } = {}) {
  if (!decision?.selected) return null;
  const expiresAt = new Date(Date.parse(sentAt) + Math.max(1, Number(expiryHours) || 336) * 3_600_000).toISOString();
  return Object.freeze({
    id: stableId("frq", conversation.id, decision.formId, draftId || "no-draft"),
    sourceConversationId: conversation.id,
    sourceContactId: conversation.contact_id || conversation.contact?.id || null,
    formKey: decision.formKey,
    formId: decision.formId,
    formUrl: decision.formUrl,
    status: "sent",
    reason: decision.reason,
    sentViaChannel: conversation.channel,
    sentDraftId: draftId,
    sentAt,
    expiresAt,
    metadata: {
      workflow: conversation.workflow,
      required: Boolean(decision.required),
      selectionSource: decision.source || "deterministic_intent",
    },
  });
}

export default decideConversationJotform;
