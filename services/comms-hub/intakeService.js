import { buildJotformIntake } from "./domain/submission.js";
import { resolveJotformWebhook } from "./domain/webhook.js";

export async function processJotformIntake({ envelope, correlationId, context, now = new Date() }) {
  const identifiers = resolveJotformWebhook(envelope);
  const submission = await context.jotform.verifySubmission(identifiers);
  const intake = buildJotformIntake({ ...identifiers, submission, correlationId, now, sourceTimeZone: context.config?.jotformSourceTimeZone || "UTC" });
  const persistence = await context.repository.persistJotformIntake(intake);
  if (!persistence.duplicate && context.workflowEngineService && intake.attachments.length) {
    const dueAt = new Date(now.getTime() + 1_000).toISOString();
    for (const attachment of intake.attachments) {
      await context.workflowEngineService.schedule({
        conversationId: intake.conversationId,
        actionType: "attachment_ingest",
        dueAt,
        payload: { attachmentId: attachment.id, providerUrl: attachment.providerUrl, filename: attachment.filename, provider: "jotform", metadata: { conversationId: intake.conversationId, contactId: intake.contactId, channel: "form" } },
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
