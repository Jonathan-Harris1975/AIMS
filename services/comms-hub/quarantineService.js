import { CommsHubError } from "./errors.js";
import { redactDiagnosticText } from "./domain/redaction.js";
import { stableId } from "./domain/ids.js";

export class CommsHubQuarantineService {
  constructor({ context }) {
    this.context = context;
    this.handlers = new Map();
  }

  register(sourceType, handler) {
    this.handlers.set(sourceType, handler);
  }

  async quarantine({ sourceType, sourceId, conversationId = null, failureClass = "recoverable", payloadReference = null,
    errorCode = null, errorMessage = "", attempts = 0, metadata = {} }) {
    const createdAt = new Date().toISOString();
    return this.context.operationsRepository.upsertQuarantineItem({
      id: stableId("qua", sourceType, sourceId),
      sourceType,
      sourceId,
      conversationId,
      failureClass,
      payloadReference,
      errorCode,
      errorMessage,
      attempts,
      idempotencyKey: `quarantine:${sourceType}:${sourceId}`,
      createdAt,
      metadata,
    });
  }

  describe(item) {
    let blocked = "";
    if (item.status !== "quarantined") blocked = item.status === "replay_pending" ? "Replay is in progress." : "This item is in history.";
    else if (!this.handlers.has(item.source_type)) blocked = "No replay handler is available.";
    else if (item.source_type === "delayed_action") {
      if (!item.action_id) blocked = "The original action no longer exists.";
      else if (item.action_failure_class === "uncertain" || ["sending", "reconciliation_required"].includes(item.email_delivery_status)) blocked = "Delivery must be reconciled before retrying.";
      else if (!["failed", "quarantined"].includes(item.action_status)) blocked = `Action is ${item.action_status}; replay is unavailable.`;
      else if (item.channel === "email" && ["admin", "newsletter"].includes(item.account_key)) blocked = "This mailbox is excluded from automated replies.";
    }
    return { ...item, error_message: redactDiagnosticText(item.error_message), replayAllowed: !blocked, replayBlockReason: blocked,
      canResolve: item.status === "quarantined" && item.action_status !== "leased"
        && item.action_failure_class !== "uncertain" && !["sending", "reconciliation_required"].includes(item.email_delivery_status) };
  }

  async list(filters) {
    return (await this.context.operationsRepository.listQuarantine(filters)).map((item) => this.describe(item));
  }

  async replay(id, identity) {
    const current = await this.context.operationsRepository.getQuarantineItem(id);
    if (!current) throw new CommsHubError(404, "quarantine_not_found", "Quarantine item was not found.");
    const eligibility = this.describe(current);
    if (!eligibility.replayAllowed) throw new CommsHubError(409, "quarantine_replay_blocked", eligibility.replayBlockReason);
    const { item, attemptId } = await this.context.operationsRepository.beginQuarantineReplay({ id, actor: identity.actor });
    const handler = this.handlers.get(item.source_type);
    if (!handler) {
      await this.context.operationsRepository.finishQuarantineReplay({
        id,
        attemptId,
        outcome: "blocked",
        detail: `No replay handler for ${item.source_type}.`,
      });
      throw new CommsHubError(409, "quarantine_replay_unsupported", "This quarantined item has no safe replay handler.");
    }
    try {
      const result = await handler(item);
      await this.context.operationsRepository.finishQuarantineReplay({ id, attemptId, outcome: "success", detail: "Replay completed." });
      await this.context.auditService.record({
        actor: identity.actor,
        role: identity.role,
        action: "quarantine_replayed",
        objectType: "quarantine",
        objectId: id,
        conversationId: item.conversation_id,
        details: { sourceType: item.source_type },
      });
      return result;
    } catch (error) {
      await this.context.operationsRepository.finishQuarantineReplay({ id, attemptId, outcome: "failed", detail: error.message });
      throw error;
    }
  }

  async tidy(identity, { dryRun = false } = {}) {
    const at = new Date();
    const result = await this.context.housekeepingRepository.tidyQuarantine({
      actor: identity.actor, at: at.toISOString(),
      orphanBefore: new Date(at.getTime() - 7 * 86400000).toISOString(), dryRun,
    });
    const purgeInput = { at: at.toISOString(), recordCutoff: new Date(at.getTime()
      - this.context.config.housekeepingCompletedRecordDays * 86400000).toISOString() };
    const purged = dryRun ? await this.context.housekeepingRepository.previewQuarantinePurge(purgeInput)
      : await this.context.housekeepingRepository.purgeQuarantineHistory(purgeInput);
    if (!dryRun) await this.context.auditService.record({ actor: identity.actor, role: identity.role,
      action: "quarantine_tidied", objectType: "quarantine", objectId: "weekly-tidy", details: { ...result, purged } });
    return { dryRun, ...result, purged };
  }

  async resolve(id, identity, { disposition = "resolved", reason = "" } = {}) {
    if (!String(reason).trim()) throw new CommsHubError(422, "quarantine_reason_required", "Enter a reason for resolving or dismissing this failure.");
    const item = await this.context.housekeepingRepository.resolveQuarantine({
      id,
      disposition,
      actor: identity.actor,
      reason,
      at: new Date().toISOString(),
    });
    await this.context.auditService.record({
      actor: identity.actor,
      role: identity.role,
      action: disposition === "dismissed" ? "quarantine_dismissed" : "quarantine_resolved",
      objectType: "quarantine",
      objectId: id,
      conversationId: item.conversation_id,
      details: { sourceType: item.source_type, reason: String(reason || "").slice(0, 1000) },
    });
    return item;
  }
}

export default CommsHubQuarantineService;
