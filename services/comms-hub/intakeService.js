import { buildJotformIntake } from "./domain/submission.js";
import { resolveJotformWebhook } from "./domain/webhook.js";
import { safeErrorLog } from "./domain/redaction.js";

export async function ingestJotformAttachments({ intake, context, logger = null }) {
  if (!intake?.attachments?.length) return Object.freeze({ requested: 0, stored: 0, failed: 0, results: [] });

  const results = [];
  for (const attachment of intake.attachments) {
    try {
      await context.repository.markAttachmentStatus?.(attachment.id, "pending");
      const stored = await context.attachmentService.ingestReference({
        attachmentId: attachment.id,
        providerUrl: attachment.providerUrl,
        filename: attachment.filename,
        provider: "jotform",
        metadata: {
          conversationId: intake.conversationId,
          contactId: intake.contactId,
          messageId: intake.messageId,
          channel: "form",
          formId: intake.formId,
          submissionId: intake.submissionId,
          questionId: attachment.questionId,
          label: attachment.label,
        },
      });
      const status = stored?.quarantined || stored?.scan_status === "pending" ? "quarantined" : "stored";
      results.push({ attachmentId: attachment.id, status, objectKey: stored?.object_key || stored?.objectKey || null });
      logger?.info?.(stored?.quarantined || stored?.scan_status === "pending" ? "commsHub.formAttachment.quarantined" : "commsHub.formAttachment.stored", {
        attachmentId: attachment.id,
        conversationId: intake.conversationId,
        filename: attachment.filename,
      });
    } catch (error) {
      await context.repository.markAttachmentStatus?.(attachment.id, "ingest_failed", {
        code: error?.code || "attachment_ingest_failed",
        failureClass: error?.failureClass || null,
      }).catch?.(() => {});
      results.push({ attachmentId: attachment.id, status: "failed", error: error?.code || error?.message || "attachment_ingest_failed" });
      logger?.error?.("commsHub.formAttachment.failed", {
        attachmentId: attachment.id,
        conversationId: intake.conversationId,
        filename: attachment.filename,
        error: safeErrorLog(error),
      });
    }
  }

  const stored = results.filter((item) => item.status === "stored").length;
  const quarantined = results.filter((item) => item.status === "quarantined").length;
  return Object.freeze({
    requested: results.length,
    stored,
    quarantined,
    failed: results.filter((item) => item.status === "failed").length,
    results: Object.freeze(results),
  });
}

export async function processJotformIntake({ envelope, correlationId, context, now = new Date() }) {
  const identifiers = resolveJotformWebhook(envelope);
  const submission = await context.jotform.verifySubmission(identifiers);
  const intake = buildJotformIntake({ ...identifiers, submission, correlationId, now, sourceTimeZone: context.config?.jotformSourceTimeZone || "UTC" });
  const persistence = await context.repository.persistJotformIntake(intake);

  // Keep the durable delayed-action record as a recovery path when that worker is enabled,
  // but form attachment ingestion no longer depends on the generic delayed worker being on.
  if (!persistence.duplicate && context.workflowEngineService && intake.attachments.length) {
    const dueAt = new Date(now.getTime() + 120_000).toISOString();
    for (const attachment of intake.attachments) {
      await context.workflowEngineService.schedule({
        conversationId: intake.conversationId,
        actionType: "attachment_ingest",
        dueAt,
        payload: { attachmentId: attachment.id, providerUrl: attachment.providerUrl, filename: attachment.filename, provider: "jotform", metadata: { conversationId: intake.conversationId, contactId: intake.contactId, messageId: intake.messageId, channel: "form", formId: intake.formId, submissionId: intake.submissionId } },
        idempotencyKey: `attachment-ingest:${attachment.id}`,
      }, { actor: "jotform-intake", role: "admin" });
    }
  }

  return {
    identifiers,
    intake,
    persistence,
    acknowledgement: Object.freeze({ provider: "jotform", sentByAims: false }),
  };
}

export default processJotformIntake;
