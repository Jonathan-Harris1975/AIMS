import { stableId } from "./domain/ids.js";

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
    if (notification && emailRequested && this.context.emailService?.sendSystemNotification) {
      await this.context.emailService.sendSystemNotification(notification).catch(() => null);
    }
    return notification;
  }

  list(filters) {
    return this.context.operationsRepository.listNotifications(filters);
  }

  mark(input) {
    return this.context.operationsRepository.markNotification(input);
  }
}

export default CommsHubNotificationService;
