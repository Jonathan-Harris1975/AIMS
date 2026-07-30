import { buildJotformIntake } from "./domain/submission.js";
import { resolveJotformWebhook } from "./domain/webhook.js";

export async function processJotformIntake({ envelope, correlationId, context, now = new Date() }) {
  const identifiers = resolveJotformWebhook(envelope);
  const submission = await context.jotform.verifySubmission(identifiers);
  const intake = buildJotformIntake({ ...identifiers, submission, correlationId, now });
  const persistence = await context.repository.persistJotformIntake(intake);
  return { identifiers, intake, persistence };
}

export default processJotformIntake;
