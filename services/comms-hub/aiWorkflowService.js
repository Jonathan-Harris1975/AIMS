import { applyBritishEnglishReplacements, britishEnglishPromptGuidance } from "../content-quality/britishEnglish.js";
import { jonathanVoicePrompt } from "../content-quality/jonathanVoice.js";
import { stableId, sha256Hex } from "./domain/ids.js";
import {
  calculatePriority,
  normaliseIntentResult,
  normaliseModerationResult,
  normaliseSummary,
  parseStrictJson,
  policyForWorkflow,
  requiresHumanApproval,
  selectWorkflow,
  validateDraft,
} from "./domain/ai.js";
import { buildApprovalRequest } from "./approvalService.js";
import { CommsHubError, toCommsHubError } from "./errors.js";
import { redactDiagnosticText } from "./domain/redaction.js";
import { isSocialChannel } from "./domain/channels.js";
import { resolveConversationAutomationExclusion } from "./domain/automationScope.js";
import { buildSmartConversationContext, smartPromptGuidance } from "./smartContextService.js";
import { buildLiveContentContext, liveContentPromptGuidance } from "./liveContentAwarenessService.js";
import { buildConversationStrategy, conversationStrategyPromptGuidance } from "./conversationStrategyService.js";
import { buildSmartResponseIntelligence, smartResponsePromptGuidance } from "./smartResponseIntelligenceService.js";
import { formPromptGuidance } from "./formOrchestrationService.js";
import { formProcessingForAi, formProcessingPromptGuidance } from "./formProcessingService.js";
import {
  assessConversationConduct,
  conductPromptGuidance,
  mergeModerationWithConduct,
  redactBadLanguageForAi,
  scanOutboundLanguagePolicy,
} from "./conversationConductService.js";
import {
  promptSecuritySystemRules,
  sanitiseUntrustedText,
  extractHttpsUrls,
  scanConversationPromptInjection,
  scanModelOutputSecurity,
  scanPromptInjection,
  validateOutboundUrls,
} from "./domain/promptSecurity.js";

const MAX_TRANSCRIPT_MESSAGES = 100;
const MAX_TRANSCRIPT_CHARACTERS = 80_000;

export function classifyCommsComplexity({ intent, priority, moderation, routing, transcript, summary, config = {} }) {
  const messageCount = Array.isArray(transcript) ? transcript.length : 0;
  const characterCount = Array.isArray(transcript)
    ? transcript.reduce((sum, message) => sum + String(message?.body || "").length, 0)
    : 0;
  const priorityThreshold = Number(config.aiComplexityPriorityScore ?? 70);
  const messageThreshold = Number(config.aiComplexityMessageCount ?? 12);
  const characterThreshold = Number(config.aiComplexityCharacterCount ?? 12_000);
  const moderationThreshold = Number(config.aiComplexityModerationSeverity ?? 0.55);
  const reasons = [];

  if (Number(priority?.score || 0) >= priorityThreshold) reasons.push("high_priority");
  if (Number(moderation?.severity || 0) >= moderationThreshold || ["high", "critical"].includes(String(moderation?.riskLevel || ""))) reasons.push("moderation_risk");
  if (["complaint", "support_request", "commercial_enquiry"].includes(String(intent?.intent || ""))) reasons.push("complex_intent");
  if (routing?.mismatch) reasons.push("workflow_mismatch");
  if (messageCount >= messageThreshold) reasons.push("long_conversation");
  if (characterCount >= characterThreshold) reasons.push("large_context");
  if (Array.isArray(summary?.unresolvedActions) && summary.unresolvedActions.length >= 3) reasons.push("multiple_unresolved_actions");

  return Object.freeze({
    complex: reasons.length > 0,
    reasons: Object.freeze(reasons),
    messageCount,
    characterCount,
  });
}

function conversationTranscript(conversation, { blockBadLanguage = true } = {}) {
  const selected = [];
  let characters = 0;
  for (let index = conversation.messages.length - 1; index >= 0 && selected.length < MAX_TRANSCRIPT_MESSAGES; index -= 1) {
    const message = conversation.messages[index];
    const body = String(message.body_text || "").slice(0, 12_000);
    const remaining = MAX_TRANSCRIPT_CHARACTERS - characters;
    if (remaining <= 0) break;
    const boundedBody = body.slice(Math.max(0, body.length - remaining));
    selected.push({
      id: message.id,
      direction: message.direction,
      sender: message.direction === "outbound" ? "Jonathan" : "external_contact",
      receivedAt: message.received_at,
      subject: blockBadLanguage
        ? redactBadLanguageForAi(sanitiseUntrustedText(message.subject || "", 1000), 1000)
        : sanitiseUntrustedText(message.subject || "", 1000),
      body: blockBadLanguage
        ? redactBadLanguageForAi(sanitiseUntrustedText(boundedBody, 12_000), 12_000)
        : sanitiseUntrustedText(boundedBody, 12_000),
    });
    characters += boundedBody.length;
  }
  return selected.reverse();
}

function jsonMessages(system, payload) {
  return [
    { role: "system", content: `${promptSecuritySystemRules()}\n\nTASK INSTRUCTIONS:\n${system}` },
    { role: "user", content: `UNTRUSTED_DATA_JSON_START\n${JSON.stringify(payload)}\nUNTRUSTED_DATA_JSON_END` },
  ];
}

async function requestJson(aiRequest, routeName, system, payload, options = {}) {
  const result = await aiRequest(routeName, {
    sessionId: payload.conversationId,
    messages: jsonMessages(system, payload),
    response_format: { type: "json_object" },
    temperature: options.temperature ?? 0.15,
    max_tokens: options.maxTokens ?? 1800,
    returnMetadata: true,
  });
  return { parsed: parseStrictJson(result.content, `${routeName} response`), result };
}

function evidencePrompt(evidence) {
  return evidence.map((item) => ({
    evidenceId: item.id,
    sourceReference: sanitiseUntrustedText(item.sourceReference, 2000),
    title: redactBadLanguageForAi(sanitiseUntrustedText(item.title, 500), 500),
    excerpt: redactBadLanguageForAi(sanitiseUntrustedText(item.excerpt, 12_000), 12_000),
  }));
}

export class CommsHubAiWorkflowService {
  constructor({ context, aiRequest = null }) {
    this.context = context;
    this.aiRequest = aiRequest;
  }

  async requestAi(routeName, options) {
    if (this.aiRequest) return this.aiRequest(routeName, options);
    const { resilientRequest } = await import("../shared/utils/ai-service.js");
    return resilientRequest(routeName, options);
  }

  async analyseConversation(conversationId, { operation = "analyse", scheduleFollowUp = true } = {}) {
    if (!this.context.config.aiEnabled) {
      throw new CommsHubError(503, "comms_hub_ai_disabled", "Comms Hub AI is disabled.", {
        publicMessage: "Comms Hub AI is not enabled.",
      });
    }
    const conversation = await this.context.repository.getConversation(conversationId);
    if (!conversation) throw new CommsHubError(404, "conversation_not_found", "Conversation was not found.");
    const automationExclusion = await resolveConversationAutomationExclusion(this.context, conversation);
    if (automationExclusion) {
      throw new CommsHubError(409, "conversation_automation_excluded", `Email account ${automationExclusion.accountKey} is outside Comms Hub automation.`, {
        failureClass: "permanent",
        publicMessage: "This conversation belongs to a mailbox that is intentionally outside AIMS automation.",
      });
    }
    if (!conversation.messages.length) throw new CommsHubError(422, "conversation_empty", "Conversation has no messages to analyse.");

    const promptInjection = scanConversationPromptInjection(conversation.messages);
    const conduct = assessConversationConduct(conversation, {
      enabled: this.context.config.smartConductEnabled,
      reviewStrikeThreshold: this.context.config.conductReviewStrikeThreshold,
      automationBlockThreshold: this.context.config.conductAutomationBlockThreshold,
    });
    const smartContext = buildSmartConversationContext(conversation, {
      enabled: this.context.config.smartContextEnabled,
      maximumBooks: this.context.config.smartMaximumBookCandidates,
    });
    const liveContent = await buildLiveContentContext(conversation, {
      enabled: this.context.config.smartLiveContentEnabled,
      maximumItems: this.context.config.smartLiveContentMaxItems,
      smartContext,
    });
    const strategy = this.context.config.smartStrategyEnabled === false
      ? Object.freeze({ enabled: false })
      : buildConversationStrategy({
          conversation,
          smartContext,
          liveContent,
          conduct,
          security: { promptInjectionDetected: promptInjection.detected },
          config: this.context.config,
        });
    const formProcessingState = conversation.channel === "form" && this.context.operationsRepository?.getFormProcessing
      ? await this.context.operationsRepository.getFormProcessing(conversationId)
      : null;
    const formProcessing = formProcessingState?.digest
      ? formProcessingForAi({
          status: formProcessingState.status,
          matchedFormRequestId: formProcessingState.matched_form_request_id || null,
          digest: formProcessingState.digest,
        })
      : null;
    const formRequests = conversation.channel !== "form" && this.context.operationsRepository?.listFormRequestsForConversation
      ? await this.context.operationsRepository.listFormRequestsForConversation(conversationId)
      : [];
    const smartGuidance = smartPromptGuidance(smartContext);
    const liveContentGuidance = liveContentPromptGuidance(liveContent);
    const strategyGuidance = conversationStrategyPromptGuidance(strategy);
    const conductGuidance = conductPromptGuidance(conduct);
    const transcript = conversationTranscript(conversation, { blockBadLanguage: this.context.config.badLanguageBlockEnabled });
    const transcriptTruncated = transcript.length < conversation.messages.length
      || conversation.messages.some((message) => String(message.body_text || "").length > 12_000);
    const startedAt = new Date().toISOString();
    const run = {
      id: stableId("airun", conversationId, operation, startedAt),
      conversationId,
      operation,
      startedAt,
      metadata: {
        workflow: conversation.workflow,
        channel: conversation.channel,
        messageCount: transcript.length,
        availableMessageCount: conversation.messages.length,
        transcriptTruncated,
        smartContext: smartContext.enabled ? {
          version: smartContext.version,
          engagementMode: smartContext.engagementMode,
          tone: smartContext.tone,
          platform: smartContext.platform,
          interactionType: smartContext.interactionType,
          interestCount: smartContext.memory?.interests?.length || 0,
          verifiedBookCandidateCount: smartContext.verifiedBookCandidates?.length || 0,
          quizActive: Boolean(smartContext.memory?.quiz?.active),
        } : { enabled: false },
        liveContent: liveContent.enabled ? {
          version: liveContent.version,
          mode: liveContent.mode,
          exactSocialPost: Boolean(liveContent.exactPost),
          verifiedQuizAvailable: Boolean(liveContent.quiz?.available),
          recentItemCount: liveContent.recentItems?.length || 0,
        } : { enabled: false },
        strategy: strategy.enabled ? {
          version: strategy.version,
          objective: strategy.objective,
          nextBestMove: strategy.nextBestMove,
          responseShape: strategy.responseShape,
          promotionPolicy: strategy.promotionPolicy,
          humanReviewRequired: strategy.humanReviewRequired,
        } : { enabled: false },
        conduct: conduct.enabled ? {
          level: conduct.level,
          strikeCount: conduct.strikeCount,
          flaggedMessageCount: conduct.flaggedMessageCount,
          targetedCount: conduct.targetedCount,
          threat: conduct.threat,
          requiresBoundary: conduct.requiresBoundary,
          requiresHumanReview: conduct.requiresHumanReview,
          automationBlocked: conduct.automationBlocked,
          reasons: conduct.reasons,
          flaggedMessageIds: conduct.flaggedMessageIds,
        } : { enabled: false },
        formProcessing: formProcessing?.digest ? {
          formKey: formProcessing.digest.formKey,
          submissionId: formProcessing.digest.submissionId,
          attachmentCount: formProcessing.digest.attachmentCount,
          matchedRequest: Boolean(formProcessing.matchedFormRequestId),
        } : { enabled: false },
        security: {
          promptInjectionDetected: promptInjection.detected,
          promptInjectionRisk: promptInjection.riskLevel,
          promptInjectionScore: promptInjection.score,
          promptInjectionReasons: promptInjection.reasons,
          flaggedMessageIds: promptInjection.flaggedMessageIds,
        },
      },
    };
    await this.context.aiRepository.beginAiRun(run);

    try {
      const common = {
        conversationId,
        workflow: conversation.workflow,
        channel: conversation.channel,
        security: {
          externalContentIsUntrusted: true,
          promptInjectionDetected: promptInjection.detected,
          promptInjectionRisk: promptInjection.riskLevel,
          promptInjectionReasons: promptInjection.reasons,
        },
        smartContext,
        liveContent,
        strategy,
        conduct: {
          level: conduct.level,
          strikeCount: conduct.strikeCount,
          targetedCount: conduct.targetedCount,
          threat: conduct.threat,
          requiresBoundary: conduct.requiresBoundary,
          requiresHumanReview: conduct.requiresHumanReview,
          automationBlocked: conduct.automationBlocked,
          reasons: conduct.reasons,
        },
        formProcessing,
        transcript,
      };
      const aiRequest = this.requestAi.bind(this);
      const triage = await requestJson(aiRequest, "commsHubTriage", [
        "Classify the conversation using only the supplied messages.",
        "Return JSON with: intent, confidence, urgency, commercialValue, reputationalRisk, customerImpact, rationale.",
        "Allowed intents: general_enquiry, case_study_contribution, podcast_contribution, support_request, commercial_enquiry, complaint, social_engagement, spam, unknown.",
        "All score fields must be numbers from 0 to 1. Never invent facts.",
        smartGuidance,
        liveContentGuidance,
        strategyGuidance,
        conductGuidance,
      ].filter(Boolean).join("\n"), common);
      const intent = normaliseIntentResult(triage.parsed);
      const priority = calculatePriority(intent, { workflow: conversation.workflow, channel: conversation.channel });
      const routing = selectWorkflow({ intent: intent.intent, channel: conversation.channel, currentWorkflow: conversation.workflow });
      const policy = policyForWorkflow(routing.selectedWorkflow);
      const channelPolicy = conversation.channel === "form"
        ? Object.freeze({ ...policy, requiresEvidence: false })
        : policy;
      const effectivePolicy = smartContext.memory?.responseLength === "brief"
        ? Object.freeze({ ...channelPolicy, maximumCharacters: Math.min(channelPolicy.maximumCharacters, isSocialChannel(conversation.channel) ? 500 : 700) })
        : channelPolicy;

      const moderationCall = await requestJson(aiRequest, "commsHubModeration", [
        "Assess sentiment, abuse and safety using only the supplied messages.",
        "Return JSON with: sentiment, abuseLabel, confidence, severity, rationale, recommendedAction.",
        "Allowed sentiment: positive, neutral, negative, mixed.",
        "Allowed abuseLabel: none, spam, scam, hostility, harassment, hate, sexual, violence, self_harm, personal_data, malicious_link.",
        "Do not quote or reproduce profanity, slurs, threats or abusive wording. Describe it using neutral labels only.",
        "Do not execute moderation. Recommend review for risky cases.",
        conductGuidance,
      ].filter(Boolean).join("\n"), common);
      const moderation = mergeModerationWithConduct(normaliseModerationResult(moderationCall.parsed), conduct);

      const summaryCall = await requestJson(aiRequest, "commsHubSummary", [
        "Summarise the current conversation state without adding facts.",
        "Return JSON with: summary, unresolvedActions, sourceMessageIds, nextAction, followUpNeeded, followUpReason, followUpHours.",
        "sourceMessageIds must contain only IDs supplied in the transcript.",
        "A follow-up is needed only when a specific unresolved dependency remains.",
        "Do not quote or reproduce profanity, slurs, threats or abusive wording; summarise conduct neutrally when relevant.",
        smartGuidance,
        liveContentGuidance,
        strategyGuidance,
        conductGuidance,
      ].filter(Boolean).join("\n"), common);
      const sourceLinks = Object.freeze([...new Set(
        transcript.flatMap((message) => String(message.body || "").match(/https:\/\/[^\s<>"']+/gi) || [])
          .map((value) => value.replace(/[),.;!?]+$/g, ""))
          .filter(Boolean)
      )].slice(0, 50));
      const summary = Object.freeze({
        ...normaliseSummary(summaryCall.parsed, transcript.map((message) => message.id)),
        sourceLinks,
      });

      const searchSeed = promptInjection.detected
        ? [conversation.subject, transcript.at(-1)?.body]
        : [
            conversation.subject,
            summary.summary,
            summary.nextAction,
            smartContext.page?.title,
            smartContext.sourceReference,
            ...(smartContext.memory?.interests || []),
            ...((smartContext.verifiedBookCandidates || []).slice(0, 2).map((book) => book.title)),
            liveContent.exactPost?.title,
            liveContent.quiz?.topic,
            ...((liveContent.recentItems || []).slice(0, 3).flatMap((item) => [item.title, item.topic])),
          ];
      const searchQueryBase = sanitiseUntrustedText(searchSeed.filter(Boolean).join("\n"), 8000);
      const searchQuery = this.context.config.badLanguageBlockEnabled
        ? redactBadLanguageForAi(searchQueryBase, 8000)
        : searchQueryBase;
      const rawEvidence = await this.context.aiSearch.searchApproved(searchQuery, {
        maximumEvidence: this.context.config.aiMaximumEvidence,
      });
      const rejectedEvidence = [];
      const evidence = rawEvidence.flatMap((item) => {
        const assessment = scanPromptInjection(`${item.title || ""}\n${item.excerpt || ""}`);
        if (assessment.detected) {
          rejectedEvidence.push({ sourceReference: item.sourceReference, riskLevel: assessment.riskLevel, reasons: assessment.reasons });
          return [];
        }
        return [{
          ...item,
          excerpt: this.context.config.badLanguageBlockEnabled
            ? redactBadLanguageForAi(sanitiseUntrustedText(item.excerpt, 12_000), 12_000)
            : sanitiseUntrustedText(item.excerpt, 12_000),
          id: stableId("evi", run.id, item.indexId, item.sourceReference, item.contentSha256),
        }];
      });
      const evidenceInjectionDetected = rejectedEvidence.length > 0;
      run.metadata.security = {
        ...run.metadata.security,
        evidencePromptInjectionDetected: evidenceInjectionDetected,
        rejectedEvidenceCount: rejectedEvidence.length,
        rejectedEvidenceReasons: [...new Set(rejectedEvidence.flatMap((item) => item.reasons || []))].slice(0, 20),
      };
      const finalStrategy = this.context.config.smartStrategyEnabled === false
        ? strategy
        : buildConversationStrategy({
            conversation,
            smartContext,
            liveContent,
            conduct,
            security: {
              promptInjectionDetected: promptInjection.detected,
              evidencePromptInjectionDetected: evidenceInjectionDetected,
            },
            config: this.context.config,
          });
      const finalStrategyGuidance = conversationStrategyPromptGuidance(finalStrategy);
      if (run.metadata.strategy && finalStrategy.enabled) {
        run.metadata.strategy = {
          version: finalStrategy.version,
          objective: finalStrategy.objective,
          nextBestMove: finalStrategy.nextBestMove,
          responseShape: finalStrategy.responseShape,
          promotionPolicy: finalStrategy.promotionPolicy,
          humanReviewRequired: finalStrategy.humanReviewRequired,
        };
      }

      const responseIntelligence = buildSmartResponseIntelligence({
        conversation, intent, moderation, summary, evidence, smartContext, strategy: finalStrategy, conduct,
        security: { promptInjectionDetected: promptInjection.detected, evidencePromptInjectionDetected: evidenceInjectionDetected },
        policy: effectivePolicy, formRequests, config: this.context.config,
      });
      const responseGuidance = smartResponsePromptGuidance(responseIntelligence);
      const jotformGuidance = formPromptGuidance(responseIntelligence.formDecision);
      const verifiedFormGuidance = formProcessingPromptGuidance(formProcessing);
      // A selected Jotform route is grounded by AIMS' own allow-listed form registry rather than
      // external AI Search evidence. Keep all other output/security checks in force, but do not
      // make a procedural form hand-off depend on an unrelated evidence result.
      const draftValidationPolicy = responseIntelligence.formDecision?.selected
        ? Object.freeze({ ...effectivePolicy, requiresEvidence: false })
        : effectivePolicy;
      run.metadata.responseIntelligence = {
        version: responseIntelligence.version,
        confidence: responseIntelligence.confidence,
        confidenceBand: responseIntelligence.confidenceBand,
        answerability: responseIntelligence.answerability,
        clarificationRequired: responseIntelligence.clarificationRequired,
        humanReviewRequired: responseIntelligence.humanReviewRequired,
        autonomousEligible: responseIntelligence.autonomousEligible,
        nextBestMove: responseIntelligence.nextBestMove,
        formKey: responseIntelligence.formDecision?.selected ? responseIntelligence.formDecision.formKey : null,
        reasons: responseIntelligence.reasons,
      };

      const complexity = classifyCommsComplexity({ intent, priority, moderation, routing, transcript, summary, config: this.context.config });
      const draftRoute = operation === "follow_up"
        ? "commsHubFollowUp"
        : complexity.complex ? "commsHubDraftComplex" : policy.modelRoute;
      const draftCall = await requestJson(aiRequest, draftRoute, [
        policy.purpose,
        operation === "follow_up" ? "This is a scheduled follow-up. Refer only to the unresolved dependency and do not repeat the full earlier reply." : "",
        britishEnglishPromptGuidance(),
        jonathanVoicePrompt({ format: "one-to-one Comms Hub reply", includeArgumentArc: false }),
        smartGuidance,
        liveContentGuidance,
        finalStrategyGuidance,
        responseGuidance,
        jotformGuidance,
        verifiedFormGuidance,
        conductGuidance,
        `Maximum length: ${effectivePolicy.maximumCharacters} characters.`,
        "Use only facts in the conversation and evidence. Do not promise unpublished content, guest slots, dates, outcomes or actions not present in the evidence.",
        "Return JSON with bodyText and evidenceSourceReferences. evidenceSourceReferences must contain the exact sourceReference values used.",
        "Do not include internal notes, confidence scores or JSON outside the object.",
      ].filter(Boolean).join("\n"), { ...common, strategy: finalStrategy, responseIntelligence, policy: effectivePolicy, summary, evidence: evidencePrompt(evidence) }, { maxTokens: 2200, temperature: 0.25 });

      const citedReferences = Array.isArray(draftCall.parsed.evidenceSourceReferences)
        ? [...new Set(draftCall.parsed.evidenceSourceReferences.map(String))]
        : [];
      const allowedReferences = new Set(evidence.map((item) => item.sourceReference));
      if (citedReferences.some((reference) => !allowedReferences.has(reference))) {
        throw new CommsHubError(422, "reply_evidence_reference_invalid", "The draft cited evidence that was not returned by an approved index.", {
          failureClass: "recoverable",
          publicMessage: "The reply cited an invalid source.",
        });
      }
      const usedEvidence = evidence.filter((item) => citedReferences.includes(item.sourceReference));
      const bodyText = applyBritishEnglishReplacements(validateDraft(draftCall.parsed, draftValidationPolicy, usedEvidence.map((item) => item.id)));
      const outputConduct = this.context.config.badLanguageBlockEnabled ? scanOutboundLanguagePolicy(bodyText) : { detected: false, reasons: [] };
      if (outputConduct.detected) {
        throw new CommsHubError(422, "ai_output_language_policy_rejected", "The AI draft failed the outbound language policy.", {
          failureClass: "recoverable",
          publicMessage: "The reply draft was blocked by the language policy.",
        });
      }
      const outputSecurity = scanModelOutputSecurity(bodyText);
      if (outputSecurity.detected) {
        throw new CommsHubError(422, "ai_output_security_rejected", "The AI draft failed security output validation.", {
          failureClass: "recoverable",
          publicMessage: "The reply draft was blocked by security validation.",
        });
      }
      const allowedOutboundUrls = [
        ...(summary.sourceLinks || []),
        ...usedEvidence.map((item) => item.sourceReference).filter((value) => /^https:\/\//i.test(String(value || ""))),
        ...((liveContent.sourceReferences || []).filter((value) => /^https:\/\//i.test(String(value || "")))),
        ...(responseIntelligence.formDecision?.selected ? [responseIntelligence.formDecision.formUrl] : []),
      ];
      const outboundUrls = validateOutboundUrls(bodyText, { allowedUrls: allowedOutboundUrls });
      if (!outboundUrls.valid) {
        throw new CommsHubError(422, "ai_output_url_unapproved", "The AI draft contained an unapproved external URL.", {
          failureClass: "recoverable",
          publicMessage: "The reply draft contained a link that was not grounded in approved evidence.",
        });
      }
      if (smartContext.memory?.linkPreference === "no_links" && extractHttpsUrls(bodyText).length > 0) {
        throw new CommsHubError(422, "ai_output_preference_violation", "The AI draft violated the visitor's explicit no-links preference.", {
          failureClass: "recoverable",
          publicMessage: "The reply draft did not respect the visitor's stated preference.",
        });
      }
      const approvalPolicy = requiresHumanApproval({
        moderation,
        priority,
        actionType: "reply",
        hasEvidence: usedEvidence.length > 0,
        policy: effectivePolicy,
        severityThreshold: this.context.config.aiAutoApprovalRiskThreshold,
        priorityScoreThreshold: this.context.config.aiApprovalPriorityScore,
        workflowMismatch: routing.mismatch,
        intent: intent.intent,
        securityRisk: promptInjection.detected || evidenceInjectionDetected,
        conductRisk: conduct.requiresHumanReview || conduct.automationBlocked,
        contextEscalation: Boolean(smartContext.escalation?.required || responseIntelligence.humanReviewRequired),
      });
      const securityReviewRequired = promptInjection.detected || evidenceInjectionDetected;
      const conductReviewRequired = conduct.requiresHumanReview || conduct.automationBlocked;
      const smartEscalationRequired = Boolean(smartContext.escalation?.required);
      const strategyReviewRequired = Boolean(finalStrategy?.humanReviewRequired);
      const queue = Object.freeze({
        key: securityReviewRequired ? "security_review" : conductReviewRequired || smartEscalationRequired || strategyReviewRequired || approvalPolicy.required || routing.mismatch ? "priority_review" : "standard",
        escalationRequired: securityReviewRequired || conductReviewRequired || smartEscalationRequired || strategyReviewRequired || approvalPolicy.required || routing.mismatch,
      });
      const draftId = stableId("drf", run.id, sha256Hex(bodyText));
      const approval = this.context.config.approvalsEnforced && approvalPolicy.required
        ? buildApprovalRequest({
            conversationId,
            targetType: "reply_draft",
            targetId: draftId,
            actionType: "send_reply",
            payload: { bodyText, evidenceIds: usedEvidence.map((item) => item.id) },
            riskLevel: moderation.riskLevel === "low" ? priority.label : moderation.riskLevel,
            metadata: { reasons: approvalPolicy.reasons, aiRunId: run.id },
          })
        : null;
      const completedAt = new Date().toISOString();
      const conversationOpen = ["open", "pending"].includes(String(conversation.status || "").toLowerCase());
      const followUp = scheduleFollowUp && !securityReviewRequired && !conduct.automationBlocked && !smartEscalationRequired && !finalStrategy?.humanReviewRequired && !responseIntelligence.humanReviewRequired && !responseIntelligence.clarificationRequired && smartContext.memory?.contactPreference !== "no_follow_up" && conversationOpen && summary.followUpNeeded
        ? {
            id: stableId("fol", conversationId, summary.followUpReason || summary.nextAction || "follow-up"),
            reason: summary.followUpReason || summary.nextAction || "Unresolved conversation action",
            dueAt: new Date(Date.parse(completedAt) + summary.followUpHours * 3_600_000).toISOString(),
            idempotencyKey: `follow-up:${conversationId}:${sha256Hex(summary.followUpReason || summary.nextAction).slice(0, 20)}`,
            metadata: { sourceAiRunId: run.id },
          }
        : null;

      const allResponses = [triage.result.content, moderationCall.result.content, summaryCall.result.content, draftCall.result.content].join("\n");
      const responseConduct = this.context.config.badLanguageBlockEnabled ? scanOutboundLanguagePolicy(allResponses) : { detected: false, reasons: [] };
      if (responseConduct.detected) {
        throw new CommsHubError(422, "ai_response_language_policy_rejected", "The AI response bundle failed the language policy.", {
          failureClass: "recoverable",
          publicMessage: "The AI response was blocked by the language policy.",
        });
      }
      const responseSecurity = scanModelOutputSecurity(allResponses);
      if (responseSecurity.detected) {
        throw new CommsHubError(422, "ai_response_security_rejected", "The AI response bundle failed security validation.", {
          failureClass: "recoverable",
          publicMessage: "The AI response was blocked by security validation.",
        });
      }
      await this.context.aiRepository.persistAnalysisBundle({
        run,
        completedAt,
        intent,
        routing,
        priority,
        queue,
        complexity,
        moderation,
        summary,
        evidence,
        draft: {
          id: draftId,
          channel: conversation.channel,
          policyKey: effectivePolicy.key,
          bodyText,
          status: approval ? "pending_approval" : "draft",
          riskLevel: moderation.riskLevel === "low" ? priority.label : moderation.riskLevel,
          requiresApproval: Boolean(approval),
          evidenceIds: usedEvidence.map((item) => item.id),
          provider: draftCall.result.providerId,
          model: draftCall.result.model,
          metadata: {
            citedSourceReferences: citedReferences,
            approvalReasons: approvalPolicy.reasons,
            modelRoute: draftRoute,
            complexity,
            smartLayers: {
              liveContentMode: liveContent.mode,
              exactSourcePost: Boolean(liveContent.exactPost),
              verifiedQuizAvailable: Boolean(liveContent.quiz?.available),
              strategyObjective: finalStrategy?.objective || null,
              nextBestMove: finalStrategy?.nextBestMove || null,
              promotionPolicy: finalStrategy?.promotionPolicy || null,
              responseIntelligence: {
                answerability: responseIntelligence.answerability,
                confidenceBand: responseIntelligence.confidenceBand,
                clarificationRequired: responseIntelligence.clarificationRequired,
                humanReviewRequired: responseIntelligence.humanReviewRequired,
                autonomousEligible: responseIntelligence.autonomousEligible,
                nextBestMove: responseIntelligence.nextBestMove,
              },
              formDecision: responseIntelligence.formDecision,
              formProcessing: formProcessing?.digest ? {
                formKey: formProcessing.digest.formKey,
                submissionId: formProcessing.digest.submissionId,
                attachmentReviewRequired: formProcessing.digest.attachmentReviewRequired,
                matchedFormRequestId: formProcessing.matchedFormRequestId,
              } : null,
            },
            security: {
              promptInjectionDetected: securityReviewRequired,
              transcriptPromptInjectionDetected: promptInjection.detected,
              evidencePromptInjectionDetected: evidenceInjectionDetected,
              rejectedEvidenceCount: rejectedEvidence.length,
              reasons: [...new Set([...promptInjection.reasons, ...rejectedEvidence.flatMap((item) => item.reasons || [])])].slice(0, 20),
            },
          },
        },
        approval,
        followUp,
        model: { provider: draftCall.result.providerId, model: draftCall.result.model, route: draftRoute, complexity },
        promptSha256: sha256Hex(JSON.stringify({ common, policy: effectivePolicy, responseIntelligence, evidence: evidencePrompt(evidence) })),
        responseSha256: sha256Hex(allResponses),
      });

      return {
        runId: run.id,
        conversationId,
        intent,
        routing,
        priority,
        queue,
        complexity,
        moderation,
        summary,
        evidenceCount: evidence.length,
        citedEvidenceCount: usedEvidence.length,
        responseIntelligence,
        formProcessing: formProcessing?.digest ? { formKey: formProcessing.digest.formKey, matchedRequest: Boolean(formProcessing.matchedFormRequestId) } : null,
        draft: { id: draftId, status: approval ? "pending_approval" : "draft", requiresApproval: Boolean(approval) },
        approval: approval ? { id: approval.id, status: "pending" } : null,
        followUp: followUp ? { id: followUp.id, dueAt: followUp.dueAt } : null,
      };
    } catch (error) {
      const normalised = toCommsHubError(error, {
        statusCode: 502,
        code: "comms_hub_ai_failed",
        failureClass: "recoverable",
        publicMessage: "Conversation analysis failed.",
      });
      await this.context.aiRepository.failAiRun({
        id: run.id,
        status: normalised.failureClass === "permanent" ? "quarantined" : "failed",
        error: redactDiagnosticText(normalised.message),
        completedAt: new Date().toISOString(),
      }).catch(() => {});
      throw normalised;
    }
  }
}

export default CommsHubAiWorkflowService;
