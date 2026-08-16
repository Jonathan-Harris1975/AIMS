import { stableId } from "./domain/ids.js";

const HUMAN_REVIEW_BLOCKERS = new Set(["security_hold", "human_handoff"]);

function text(value, max = 20_000) {
  return String(value ?? "").trim().slice(0, max);
}

function inboundText(conversation) {
  return (conversation?.messages || [])
    .filter((message) => message?.direction !== "outbound")
    .map((message) => `${message?.subject || ""}\n${message?.body_text || ""}`)
    .join("\n")
    .slice(-60_000);
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

  const body = inboundText(conversation).toLowerCase();
  const nowMs = Date.now();
  const activeRequests = (Array.isArray(formRequests) ? formRequests : []).filter((request) => {
    if (!["sent", "submitted", "processed"].includes(String(request?.status || ""))) return false;
    const expiryMs = Date.parse(String(request?.expires_at || request?.expiresAt || ""));
    return !Number.isFinite(expiryMs) || expiryMs > nowMs || request.status !== "sent";
  });
  const alreadyActive = (key) => activeRequests.find((request) => String(request?.form_key || request?.formKey || "") === key);
  const intentName = String(intent?.intent || "");
  const latestAction = text(summary?.nextAction, 1000).toLowerCase();
  const explicitlyWantsForm = /\b(form|application|apply|submit|questionnaire|send (?:you )?my details|where do i send|how do i contribute)\b/i.test(body);
  const wantsPodcastParticipation = intentName === "podcast_contribution" || /\b(podcast|turing'?s torch)\b[\s\S]{0,120}\b(guest|appear|contribut|interview|join|take part|be on)\b/i.test(body) || /\b(guest|contribut|interview)\b[\s\S]{0,120}\bpodcast\b/i.test(body);
  const wantsCaseStudy = intentName === "case_study_contribution" || /\b(case study|success story|share (?:my|our) experience|contribute (?:a )?(?:case|story)|project results?|implementation story)\b/i.test(body);
  const structuredContactNeeded = /\b(proposal|media enquiry|speaking enquiry|consulting brief|partnership proposal|collaboration proposal|attach(?:ment)?|send (?:a )?brief|detailed requirements)\b/i.test(body)
    || /\bstructured (?:details|information)\b/i.test(latestAction);

  if (wantsPodcastParticipation) {
    if (alreadyActive("podcast_enquiry")) return Object.freeze({ selected: false, reason: "form_already_active", formKey: "podcast_enquiry", activeRequest: true });
    return formDecision("podcast_enquiry", {
      reason: "podcast_participation_requires_structured_intake",
      required: true,
      config,
    });
  }
  if (wantsCaseStudy) {
    if (alreadyActive("case_study")) return Object.freeze({ selected: false, reason: "form_already_active", formKey: "case_study", activeRequest: true });
    return formDecision("case_study", {
      reason: "case_study_contribution_requires_structured_intake",
      required: true,
      config,
    });
  }
  if (structuredContactNeeded || (explicitlyWantsForm && ["commercial_enquiry", "support_request", "general_enquiry"].includes(intentName))) {
    if (alreadyActive("contact")) return Object.freeze({ selected: false, reason: "form_already_active", formKey: "contact", activeRequest: true });
    return formDecision("contact", {
      reason: structuredContactNeeded ? "structured_contact_details_helpful" : "visitor_explicitly_requested_form",
      required: false,
      config,
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
    id: stableId("frq", conversation.id, decision.formId),
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
