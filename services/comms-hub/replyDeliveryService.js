import { CommsHubError } from './errors.js';
import { isSocialChannel } from './domain/channels.js';
import { executeSocialAction } from './socialActionsService.js';

export class CommsHubReplyDeliveryService {
  constructor({ context }) { this.context = context; }
  async send({ conversation, draft, idempotencyKey, scheduledDelivery = false }) {
    const channel = conversation.channel;
    if (channel === 'email') return this.context.emailService.send({ conversationId: conversation.id, bodyText: draft.body_text, bodyHtml: draft.body_html, subject:
       draft.subject || '', idempotencyKey, scheduledDelivery });
    if (channel === 'chat') return this.context.chatService.send({ conversationId: conversation.id, message: draft.body_text, idempotencyKey });
    if (channel === 'form') return this.context.emailService.sendFormResponse({ conversationId: conversation.id, bodyText: draft.body_text, bodyHtml: draft.body_html, subject:
       draft.subject || '', idempotencyKey, scheduledDelivery });
    if (isSocialChannel(channel)) return executeSocialAction({ conversationId: conversation.id, action: 'reply', body: { message: draft.body_text }, idempotencyKey, context: this.context });
    throw new CommsHubError(422, 'reply_channel_unsupported', `Reply delivery is unsupported for channel ${channel}.`);
  }
}
export default CommsHubReplyDeliveryService;
