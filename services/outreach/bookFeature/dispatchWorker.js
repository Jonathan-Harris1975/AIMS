import { createHash } from "node:crypto";
import { getObjectAsText } from "../../shared/utils/r2-client.js";
import { OutreachRepository } from "../services/outreachRepository.js";

function backoff(attempt, now) {
  const minutes = Math.min(60, Math.max(1, 2 ** Math.max(0, attempt - 1)));
  const jitter = (attempt * 7919) % 31;
  return new Date(now.getTime() + (minutes * 60 + jitter) * 1000).toISOString();
}

export class BookFeatureDispatchWorker {
  constructor({ repository, context, readPrivate = getObjectAsText, now = () => new Date() }) {
    this.repository = repository;
    this.context = context;
    this.readPrivate = readPrivate;
    this.now = now;
    this.shared = new OutreachRepository(context.d1);
  }

  async runOnce() {
    const lease = await this.repository.claimOutbox();
    if (!lease) return { processed: false, reason: "no_authorised_work" };
    let handoffStarted = false;
    let handoffRecorded = false;
    try {
      const context = await this.repository.outboxDispatchContext(lease.id);
      const config = await this.repository.mode();
      const email = String(context?.email || "").toLowerCase();
      const controlled = config.effective === "controlled_test";
      if (config.killSwitch || !["controlled_test","pilot"].includes(config.effective) ||
          (controlled && !config.testRecipients.includes(email))) {
        await this.repository.finishOutboxLease(lease, { status: "cancelled", failureClass: "policy", errorCode: "mode_or_kill_switch" });
        return { processed: true, status: "cancelled" };
      }
      if (!context || context.validation_result !== "valid" || context.eligibility_status !== "eligible" ||
          !(Date.parse(context.validation_expires_at || "") > this.now().getTime())) {
        await this.repository.finishOutboxLease(lease, { status: "cancelled", failureClass: "policy", errorCode: "contact_eligibility_expired" });
        return { processed: true, status: "cancelled" };
      }
      if ((await this.shared.isSuppressed(email, context.official_domain) ||
          (context.intended_email && await this.shared.isSuppressed(context.intended_email, context.official_domain)))) {
        await this.repository.finishOutboxLease(lease, { status: "cancelled", failureClass: "policy", errorCode: "suppressed_before_handoff" });
        return { processed: true, status: "cancelled" };
      }
      const archived = JSON.parse(await this.readPrivate("kdp", context.body_key));
      if (archived?.pitch?.subject !== context.subject || !archived?.pitch?.body) {
        throw Object.assign(new Error("Archived pitch is unavailable."), {
          code: "PITCH_ARCHIVE_INVALID", failureClass: "permanent",
        });
      }
      const conversation = await this.shared.createOutboundConversation({ email, displayName: context.display_name || email,
        domain: context.official_domain, keyword: "book feature", subject: context.subject,
        sourceUrl: `https://${context.official_domain}`, sourceTitle: context.canonical_name,
        workflow: "outreach_book_feature", campaignType: "book_feature", opportunityId: context.opportunity_id });
      // Final mode/suppression recheck occurs after storage and conversation work,
      // immediately before provider handoff.
      const finalConfig = await this.repository.mode();
      if (finalConfig.killSwitch || !["controlled_test","pilot"].includes(finalConfig.effective) ||
          (finalConfig.effective === "controlled_test" && !finalConfig.testRecipients.includes(email)) ||
          await this.shared.isSuppressed(email, context.official_domain) ||
          (context.intended_email && await this.shared.isSuppressed(context.intended_email, context.official_domain))) {
        await this.repository.finishOutboxLease(lease, { status: "cancelled", failureClass: "policy", errorCode: "final_handoff_gate_failed" });
        return { processed: true, status: "cancelled" };
      }
      if (!(Date.parse(context.validation_expires_at || "") > this.now().getTime()) ||
          !(Date.parse(lease.lease_expires_at || "") > this.now().getTime())) {
        await this.repository.finishOutboxLease(lease, { status: "cancelled", failureClass: "policy", errorCode: "handoff_expired" });
        return { processed: true, status: "cancelled" };
      }
      const contentHash = createHash("sha256").update(`${archived.pitch.subject}\n${archived.pitch.body}`).digest("hex");
      if (!await this.repository.admitHandoff(lease, contentHash)) {
        await this.repository.finishOutboxLease(lease, { status: "cancelled", failureClass: "policy", errorCode: "atomic_admission_denied" });
        return { processed: true, status: "cancelled" };
      }
      // Once provider handoff begins, an exception is not proof of non-delivery.
      handoffStarted = true;
      const sent = await this.context.emailService.send({ conversationId: conversation.conversationId,
        bodyText: archived.pitch.body, subject: archived.pitch.subject, recipients: [email],
        idempotencyKey: context.idempotency_key, scheduledDelivery: true });
      const providerMessageId = sent?.providerMessageId || sent?.response?.messageId || sent?.messageId || null;
      const acceptedAt = this.now().toISOString();
      await this.repository.finishOutboxLease(lease, { status: "accepted", providerMessageId, acceptedAt });
      handoffRecorded = true;
      await this.repository.recordDeliveryEvent({ outboxId: lease.id,
        providerEventId: `submission:${lease.id}:${lease.attempt_count}`, eventType: "accepted", providerMessageId,
        occurredAt: acceptedAt, evidence: { duplicate: Boolean(sent?.duplicate) } });
      return { processed: true, status: "accepted", outboxId: lease.id, providerMessageId };
    } catch (error) {
      if (handoffRecorded) {
        // Acceptance was already persisted; do not try to finish the lease twice.
        return { processed: true, status: "accepted", outboxId: lease.id, reconciliationRequired: true };
      }
      if (handoffStarted || error?.deliveryUncertain || error?.failureClass === "uncertain") {
        await this.repository.finishOutboxLease(lease, { status: "unknown", failureClass: "uncertain",
          errorCode: String(error?.code || "provider_outcome_unknown").slice(0, 100) });
        return { processed: true, status: "unknown", reconciliationRequired: true };
      }
      const retryable = error?.retryable === true || error?.failureClass === "temporary";
      const canRetry = retryable && Number(lease.attempt_count) < Number(lease.max_attempts);
      await this.repository.finishOutboxLease(lease, canRetry
        ? { status: "queued", failureClass: "temporary", errorCode: String(error?.code || "dispatch_failed").slice(0,100),
          nextAttemptAt: backoff(Number(lease.attempt_count), this.now()) }
        : { status: "quarantined", failureClass: error?.failureClass || "permanent",
          errorCode: String(error?.code || "dispatch_failed").slice(0,100) });
      return { processed: true, status: canRetry ? "retry_pending" : "quarantined" };
    }
  }
}

export default BookFeatureDispatchWorker;
