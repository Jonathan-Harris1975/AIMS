import { stableId } from "./domain/ids.js";
import { CommsHubError } from "./errors.js";

const NOTIFICATION_EMAIL_MAX_ATTEMPTS = 6;

function notificationEmailActionId(notificationId) {
  return stableId("delay", "notification-email", notificationId);
}

export class CommsHubNotificationService {
  constructor({ context }) {
    this.context = context;
  }

  async create({ actor, conversationId = null, type, title, bodyText, severity = "info", emailRequested = false, metadata = {}, idempotencySeed = "" }) {
    const createdAt = new Date().toISOString();
    const notification = await this.context.operationsRepository.createNotification({
      id: stableId("ntf", actor, conversationId || "system", type, idempotencySeed || createdAt),
      actor,
      conversationId,
      type,
      title,
      bodyText,
      severity,
      emailRequested,
      metadata,
      createdAt,
    });
    if (!notification) {
      throw new CommsHubError(500, "notification_not_persisted", "Notification creation did not persist a record.");
    }
    if (emailRequested && notification.email_delivery_status !== "sent") {
      await this.context.operationsRepository.scheduleDelayedAction({
        id: notificationEmailActionId(notification.id),
        conversationId: null,
        actionType: "notification_email",
        payload: { notificationId: notification.id },
        dueAt: createdAt,
        maxAttempts: NOTIFICATION_EMAIL_MAX_ATTEMPTS,
        idempotencyKey: `notification-email:${notification.id}`,
        actor: "notification-service",
        createdAt,
      });
    }
    return notification;
  }

  list(filters) {
    return this.context.operationsRepository.listNotifications(filters);
  }

  mark(input) {
    return this.context.operationsRepository.markNotification(input);
  }

  async reconcileEmail({ id, outcome, providerMessageId = null, actor = "operator" }) {
    if (outcome === "retry") {
      const current = await this.context.operationsRepository.getNotification(id);
      if (!current || current.email_delivery_status !== "reconciliation_required") {
        throw new CommsHubError(409, "notification_email_not_reconcilable", "Notification email is not awaiting reconciliation.");
      }
      const reset = await this.context.operationsRepository.resetDelayedActionForReplayByIdempotencyKey(`notification-email:${id}`);
      if (!reset) {
        throw new CommsHubError(409, "notification_email_retry_not_available", "Notification email retry work could not be reset.");
      }
    }
    return this.context.operationsRepository.reconcileNotificationEmail({
      id,
      outcome,
      providerMessageId,
      actor,
    });
  }
}

export default CommsHubNotificationService;
