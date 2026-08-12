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

function conversationTranscript(conversation) {
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
      sender: message.sender || "unknown",
      receivedAt: message.received_at,
      subject: message.subject || "",
      body: boundedBody,
    });
    characters += boundedBody.length;
  }
  return selected.reverse();
}

function jsonMessages(system, payload) {
  return [
    { role: "system", content: system },
    { role: "user", content: JSON.stringify(payload) },
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
    sourceReference: item.sourceReference,
    title: item.title,
    excerpt: item.excerpt,
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
    if (!conversation.messages.length) throw new CommsHubError(422, "conversation_empty", "Conversation has no messages to analyse.");

    const transcript = conversationTranscript(conversation);
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
      },
    };
    await this.context.aiRepository.beginAiRun(run);

    try {
      const common = { conversationId, workflow: conversation.workflow, channel: conversation.channel, transcript };
      const aiRequest = this.requestAi.bind(this);
      const triage = await requestJson(aiRequest, "commsHubTriage", [
        "Classify the conversation using only the supplied messages.",
        "Return JSON with: intent, confidence, urgency, commercialValue, reputationalRisk, customerImpact, rationale.",
        "Allowed intents: general_enquiry, case_study_contribution, podcast_contribution, support_request, commercial_enquiry, complaint, social_engagement, spam, unknown.",
        "All score fields must be numbers from 0 to 1. Never invent facts.",
      ].join("\n"), common);
      const intent = normaliseIntentResult(triage.parsed);
      const priority = calculatePriority(intent, { workflow: conversation.workflow, channel: conversation.channel });
      const routing = selectWorkflow({ intent: intent.intent, channel: conversation.channel, currentWorkflow: conversation.workflow });
      const policy = policyForWorkflow(routing.selectedWorkflow);

      const moderationCall = await requestJson(aiRequest, "commsHubModeration", [
        "Assess sentiment, abuse and safety using only the supplied messages.",
        "Return JSON with: sentiment, abuseLabel, confidence, severity, rationale, recommendedAction.",
        "Allowed sentiment: positive, neutral, negative, mixed.",
        "Allowed abuseLabel: none, spam, scam, hostility, harassment, hate, sexual, violence, self_harm, personal_data, malicious_link.",
        "Do not execute moderation. Recommend review for risky cases.",
      ].join("\n"), common);
      const moderation = normaliseModerationResult(moderationCall.parsed);

      const summaryCall = await requestJson(aiRequest, "commsHubSummary", [
        "Summarise the current conversation state without adding facts.",
        "Return JSON with: summary, unresolvedActions, sourceMessageIds, nextAction, followUpNeeded, followUpReason, followUpHours.",
        "sourceMessageIds must contain only IDs supplied in the transcript.",
        "A follow-up is needed only when a specific unresolved dependency remains.",
      ].join("\n"), common);
      const sourceLinks = Object.freeze([...new Set(
        transcript.flatMap((message) => String(message.body || "").match(/https:\/\/[^\s<>"']+/gi) || [])
          .map((value) => value.replace(/[),.;!?]+$/g, ""))
          .filter(Boolean)
      )].slice(0, 50));
      const summary = Object.freeze({
        ...normaliseSummary(summaryCall.parsed, transcript.map((message) => message.id)),
        sourceLinks,
      });

      const searchQuery = [conversation.subject, summary.summary, summary.nextAction].filter(Boolean).join("\n");
      const rawEvidence = await this.context.aiSearch.searchApproved(searchQuery, {
        maximumEvidence: this.context.config.aiMaximumEvidence,
      });
      const evidence = rawEvidence.map((item) => ({
        ...item,
        id: stableId("evi", run.id, item.indexId, item.sourceReference, item.contentSha256),
      }));

      const complexity = classifyCommsComplexity({ intent, priority, moderation, routing, transcript, summary, config: this.context.config });
      const draftRoute = operation === "follow_up"
        ? "commsHubFollowUp"
        : complexity.complex ? "commsHubDraftComplex" : policy.modelRoute;
      const draftCall = await requestJson(aiRequest, draftRoute, [
        policy.purpose,
        operation === "follow_up" ? "This is a scheduled follow-up. Refer only to the unresolved dependency and do not repeat the full earlier reply." : "",
        britishEnglishPromptGuidance(),
        jonathanVoicePrompt({ format: "one-to-one Comms Hub reply", includeArgumentArc: false }),
        `Maximum length: ${policy.maximumCharacters} characters.`,
        "Use only facts in the conversation and evidence. Do not promise unpublished content, guest slots, dates, outcomes or actions not present in the evidence.",
        "Return JSON with bodyText and evidenceSourceReferences. evidenceSourceReferences must contain the exact sourceReference values used.",
        "Do not include internal notes, confidence scores or JSON outside the object.",
      ].join("\n"), { ...common, policy, summary, evidence: evidencePrompt(evidence) }, { maxTokens: 2200, temperature: 0.25 });

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
      const bodyText = applyBritishEnglishReplacements(validateDraft(draftCall.parsed, policy, usedEvidence.map((item) => item.id)));
      const approvalPolicy = requiresHumanApproval({
        moderation,
        priority,
        actionType: "reply",
        hasEvidence: usedEvidence.length > 0,
        policy,
        severityThreshold: this.context.config.aiAutoApprovalRiskThreshold,
        priorityScoreThreshold: this.context.config.aiApprovalPriorityScore,
        workflowMismatch: routing.mismatch,
        intent: intent.intent,
      });
      const queue = Object.freeze({
        key: approvalPolicy.required || routing.mismatch ? "priority_review" : "standard",
        escalationRequired: approvalPolicy.required || routing.mismatch,
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
      const followUp = scheduleFollowUp && conversationOpen && summary.followUpNeeded
        ? {
            id: stableId("fol", conversationId, summary.followUpReason || summary.nextAction || "follow-up"),
            reason: summary.followUpReason || summary.nextAction || "Unresolved conversation action",
            dueAt: new Date(Date.parse(completedAt) + summary.followUpHours * 3_600_000).toISOString(),
            idempotencyKey: `follow-up:${conversationId}:${sha256Hex(summary.followUpReason || summary.nextAction).slice(0, 20)}`,
            metadata: { sourceAiRunId: run.id },
          }
        : null;

      const allResponses = [triage.result.content, moderationCall.result.content, summaryCall.result.content, draftCall.result.content].join("\n");
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
          policyKey: policy.key,
          bodyText,
          status: approval ? "pending_approval" : "draft",
          riskLevel: moderation.riskLevel === "low" ? priority.label : moderation.riskLevel,
          requiresApproval: Boolean(approval),
          evidenceIds: usedEvidence.map((item) => item.id),
          provider: draftCall.result.providerId,
          model: draftCall.result.model,
          metadata: { citedSourceReferences: citedReferences, approvalReasons: approvalPolicy.reasons, modelRoute: draftRoute, complexity },
        },
        approval,
        followUp,
        model: { provider: draftCall.result.providerId, model: draftCall.result.model, route: draftRoute, complexity },
        promptSha256: sha256Hex(JSON.stringify({ common, policy, evidence: evidencePrompt(evidence) })),
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
