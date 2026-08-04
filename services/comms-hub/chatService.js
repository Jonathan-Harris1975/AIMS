import { CommsHubError } from './errors.js';
import { sha256Hex, stableId } from './domain/ids.js';

export class CommsHubChatService {
  constructor({ context }) { this.context = context; }

  async acceptWebhook(req) {
    if (!this.context.config.chatEnabled) throw new CommsHubError(409, 'chat_channel_disabled', 'Website chat channel is disabled.');
    const verified = await this.context.coginPal.readWebhook(req, this.context.operationsRepository);
    const payload = verified.payload || {};
    const sessionId = String(payload.sessionId || payload.session_id || '').trim();
    const visitorId = String(payload.visitorId || payload.visitor_id || '').trim();
    const websiteId = String(payload.websiteId || payload.website_id || 'jonathan-harris.online').trim();
    const text = String(payload.message?.text || payload.text || '').trim();
    const providerMessageId = String(payload.message?.id || payload.messageId || payload.eventId || verified.nonce).trim();
    if (!sessionId || !visitorId || !text) throw new CommsHubError(422, 'chat_payload_invalid', 'Chat webhook payload is incomplete.');
    const now = new Date().toISOString();
    const contactId = stableId('con', 'chat', websiteId, visitorId);
    const conversationId = stableId('cnv', 'chat', websiteId, sessionId);
    const messageId = stableId('msg', 'chat', providerMessageId);
    const persistence = await this.context.operationsRepository.persistChannelMessage({ contact: { id: contactId, primaryEmail: String(payload.email || ''), displayName: String(payload.name || `Website visitor ${visitorId.slice(-6)}`), phone: '' }, conversation: { id: conversationId, channel: 'chat', provider: 'coginpal', workflow: 'website_chat', status: 'open', contactId, subject: 'Website chat', sourceReference: sessionId, metadata: { websiteId, visitorId } }, message: { id: messageId, direction: 'inbound', sender: visitorId, recipients: ['website'], subject: 'Website chat', bodyText: text, bodyHtml: null, providerMessageId, receivedAt: String(payload.occurredAt || now), metadata: { payloadSha256: verified.payloadSha256 } }, at: now });
    await this.context.operationsRepository.ensureConversationOperations(conversationId, 'chat-adapter', now);
    await this.context.operationsRepository.upsertChatSession({ id: stableId('cht', 'coginpal', websiteId, sessionId), conversationId, provider: 'coginpal', providerSessionId: sessionId, websiteId, visitorId, mode: 'automation', assignedActor: null, createdAt: now, metadata: {} });
    await this.context.operationsRepository.addContactAlias({ id: stableId('als', 'chat', websiteId, visitorId), contactId, type: 'chat', value: visitorId, provider: 'coginpal', confidence: 1, verified: true, createdAt: now, metadata: { websiteId } });
    await this.context.operationsRepository.indexSearchDocument({ id: stableId('srch', 'message', messageId), objectType: 'message', objectId: messageId, conversationId, contactId, channel: 'chat', searchableText: text, metadata: {}, updatedAt: now });
    await this.context.workflowEngineService.evaluate({ conversationId, event: { type: 'message_received', channel: 'chat', sender: visitorId, text, occurredAt: now } });
    if (this.context.config.wakeEnabled) await this.context.wakeClient.requestWake({ eventId: providerMessageId, reason: 'website_chat', source: 'coginpal', receivedAt: now });
    return { duplicate: persistence.duplicate, conversationId, messageId };
  }

  async send({ conversationId, message, idempotencyKey }) {
    if (!this.context.config.chatEnabled) throw new CommsHubError(409, 'chat_channel_disabled', 'Website chat channel is disabled.');
    if (!idempotencyKey) throw new CommsHubError(400, 'idempotency_key_required', 'Idempotency-Key is required.');
    const session = await this.context.operationsRepository.getChatSessionByConversation(conversationId);
    if (!session) throw new CommsHubError(404, 'chat_session_not_found', 'Chat session was not found.');
    const requestSha256 = sha256Hex(message);
    const claim = await this.context.operationsRepository.claimChannelOutboundAction({ id: stableId('coa', idempotencyKey), idempotencyKey, conversationId, channel: 'chat', actionType: 'reply', requestSha256 });
    if (!claim.acquired) {
      if (claim.duplicate) return { duplicate: true, providerMessageId: claim.existing.provider_message_id };
      throw new CommsHubError(409, 'chat_send_in_progress', 'Chat send is already in progress.');
    }
    try {
      const response = await this.context.coginPal.sendMessage({ sessionId: session.provider_session_id, message, idempotencyKey });
      const providerMessageId = String(response.messageId || response.id || stableId('cpm', idempotencyKey));
      const at = new Date().toISOString();
      await this.context.operationsRepository.recordOutboundMessage({ id: stableId('msg', 'chat-out', providerMessageId), conversationId, sender: session.assigned_actor || 'AIMS', recipients: [session.visitor_id], subject: 'Website chat', bodyText: message, providerMessageId, receivedAt: at, metadata: { mode: session.mode } });
      await this.context.operationsRepository.completeChannelOutboundAction({ idempotencyKey, providerMessageId, response, at });
      return { duplicate: false, providerMessageId };
    } catch (error) {
      await this.context.operationsRepository.failChannelOutboundAction({ idempotencyKey, failureClass: error.failureClass || 'temporary', error: error.message, reconciliationRequired: Boolean(error.retryable) });
      throw error;
    }
  }

  async takeover({ conversationId, mode, actor }) {
    if (!['takeover_requested', 'human', 'automation', 'closed'].includes(mode)) throw new CommsHubError(400, 'chat_takeover_mode_invalid', 'Chat takeover mode is invalid.');
    return this.context.operationsRepository.updateChatTakeover({ conversationId, mode, actor });
  }
}
export default CommsHubChatService;
