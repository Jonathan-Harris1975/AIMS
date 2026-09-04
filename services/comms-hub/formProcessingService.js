import { CommsHubError } from "./errors.js";
import { sendReplyDraft } from "./replyDraftService.js";
import { sanitiseUntrustedText } from "./domain/promptSecurity.js";

function clean(value, max = 4000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

function display(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return clean(value, 4000);
  if (["number", "boolean"].includes(typeof value)) return String(value);
  if (Array.isArray(value)) return value.map(display).filter(Boolean).join(", ").slice(0, 4000);
  if (typeof value === "object") return Object.values(value).map(display).filter(Boolean).join(" ").slice(0, 4000);
  return "";
}

export function buildJotformInformationDigest(intake) {
  const facts = (JSON.parse(intake.payloadJson || "{}")?.answers || [])
    .filter((answer) => !["control_email", "control_phone", "control_fullname", "control_address", "control_fileupload"].includes(answer.type))
    .map((answer) => ({
      questionId: String(answer.questionId || "").slice(0, 100),
      label: clean(answer.label || answer.name || `Question ${answer.questionId}`, 300),
      value: display(answer.value),
    }))
    .filter((item) => item.value)
    .slice(0, 80);

  const missing = [];
  if (!intake.contact?.email) missing.push("email");
  if (!facts.length) missing.push("substantive_answers");

  return Object.freeze({
    schemaVersion: 1,
    formKey: intake.route.key,
    workflow: intake.route.workflow,
    formId: intake.formId,
    submissionId: intake.submissionId,
    submittedAt: intake.receivedAt,
    contact: {
      name: clean(intake.contact?.name, 300) || null,
      email: clean(intake.contact?.email, 320).toLowerCase() || null,
      phone: clean(intake.contact?.phone, 100) || null,
    },
    facts: Object.freeze(facts),
    attachmentCount: intake.attachments?.length || 0,
    attachmentReviewRequired: (intake.attachments?.length || 0) > 0,
    missing: Object.freeze(missing),
    canReplyByEmail: Boolean(intake.contact?.email),
    creativeReuseInScope: ["case_study", "podcast_enquiry"].includes(intake.route.key),
  });
}

export function formProcessingForAi(formProcessing) {
  if (!formProcessing?.digest) return null;
  const digest = formProcessing.digest;
  return Object.freeze({
    status: formProcessing.status || null,
    matchedFormRequestId: formProcessing.matchedFormRequestId || null,
    digest: Object.freeze({
      schemaVersion: digest.schemaVersion,
      formKey: digest.formKey,
      workflow: digest.workflow,
      formId: digest.formId,
      submissionId: digest.submissionId,
      submittedAt: digest.submittedAt,
      contact: Object.freeze({
        nameSupplied: Boolean(digest.contact?.name),
        emailSupplied: Boolean(digest.contact?.email),
        phoneSupplied: Boolean(digest.contact?.phone),
      }),
      facts: Object.freeze((digest.facts || []).slice(0, 80).map((item) => Object.freeze({
        questionId: String(item.questionId || "").slice(0, 100),
        label: sanitiseUntrustedText(item.label, 300),
        value: sanitiseUntrustedText(item.value, 4000),
      }))),
      attachmentCount: Number(digest.attachmentCount || 0),
      attachmentReviewRequired: Boolean(digest.attachmentReviewRequired),
      missing: Object.freeze([...(digest.missing || [])].slice(0, 20)),
      canReplyByEmail: Boolean(digest.canReplyByEmail),
      creativeReuseInScope: Boolean(digest.creativeReuseInScope),
    }),
  });
}

export function formProcessingPromptGuidance(formProcessing) {
  if (!formProcessing?.digest) return "";
  return [
    "VERIFIED JOTFORM PROCESSING RULES:",
    `- Form type: ${formProcessing.digest.formKey}.`,
    `- Verified submission ID: ${formProcessing.digest.submissionId}.`,
    `- Substantive field count: ${formProcessing.digest.facts.length}.`,
    `- Attachment count: ${formProcessing.digest.attachmentCount}.`,
    "- Jotform already owns the immediate receipt acknowledgement. Do not send a duplicate 'we received your form' acknowledgement.",
    "- Produce a substantive processed response: answer what can be answered, identify only genuinely missing information, and state the next communication step without \
promising acceptance/publication/booking.",
    "- Treat uploaded attachments as unavailable for substantive inference until the secure attachment pipeline has completed; never invent their contents.",
    "- Downstream blog/social/podcast editorial automation is handled by a separate controlled queue. Do not start it from the reply model, claim that publication is \
guaranteed, or expose internal automation details.",
  ].join("\n");
}

export class CommsHubFormProcessingService {
  constructor({ context }) {
    this.context = context;
  }

  async registerVerifiedSubmission({ intake, duplicate = false }) {
    const digest = buildJotformInformationDigest(intake);
    if (duplicate) return { duplicate: true, digest };
    const match = await this.context.operationsRepository.matchPendingFormRequestForSubmission?.({
      formId: intake.formId,
      email: intake.contact?.email,
      submissionConversationId: intake.conversationId,
      submissionId: intake.submissionId,
      submittedAt: intake.receivedAt,
    });
    const processing = await this.context.operationsRepository.upsertFormProcessing?.({
      conversationId: intake.conversationId,
      formId: intake.formId,
      submissionId: intake.submissionId,
      formKey: intake.route.key,
      status: digest.canReplyByEmail ? "digest_ready" : "review_required",
      matchedFormRequestId: match?.id || null,
      digest,
      createdAt: intake.processedAt,
    });
    return { duplicate: false, digest, match, processing };
  }

  async processConversation(conversationId, { autoSend = this.context.config.formAutoSendEnabled } = {}) {
    if (!this.context.config.formSmartProcessingEnabled) {
      throw new CommsHubError(409, "form_smart_processing_disabled", "Smart form processing is disabled.");
    }
    const state = await this.context.operationsRepository.getFormProcessing?.(conversationId);
    if (!state) throw new CommsHubError(404, "form_processing_not_found", "Form processing state was not found.");
    if (["replied"].includes(state.status)) return { duplicate: true, state };
    if (!this.context.config.aiEnabled) {
      await this.context.operationsRepository.updateFormProcessing?.({ conversationId, status: "review_required", error: "ai_disabled" });
      return { processed: false, reviewRequired: true, reason: "ai_disabled" };
    }
    await this.context.operationsRepository.updateFormProcessing?.({ conversationId, status: "processing" });
    try {
      const analysis = await this.context.aiWorkflowService.analyseConversation(conversationId, { operation: "form_submission", scheduleFollowUp: false });
      const draft = analysis?.draft || {};
      const status = draft.requiresApproval ? "pending_approval" : "draft_ready";
      await this.context.operationsRepository.updateFormProcessing?.({
        conversationId,
        status,
        aiRunId: analysis?.runId || analysis?.aiRunId || null,
        replyDraftId: draft.id || null,
      });
      const responseEligible = analysis?.responseIntelligence?.autonomousEligible === true;
      if (!autoSend || !draft.id || draft.requiresApproval || !responseEligible || state?.digest?.attachmentReviewRequired) {
        return { processed: true, sent: false, status, responseEligible, analysis };
      }
      const sent = await sendReplyDraft({ draftId: draft.id, context: this.context });
      if (sent?.scheduled) {
        return { processed: true, sent: false, scheduled: true, dueAt: sent.dueAt, status: "draft_ready", analysis, delivery: sent };
      }
      return { processed: true, sent: true, status: "replied", analysis, delivery: sent };
    } catch (error) {
      await this.context.operationsRepository.updateFormProcessing?.({
        conversationId,
        status: "failed",
        failureClass: error?.failureClass || "recoverable",
        error: error?.code || error?.message || "form_processing_failed",
      }).catch(() => null);
      throw error;
    }
  }
}

export default CommsHubFormProcessingService;
