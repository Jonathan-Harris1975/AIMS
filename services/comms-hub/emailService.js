import { CommsHubError } from './errors.js';
import { emailThreadKey } from './domain/email.js';
import { sha256Hex, stableId } from './domain/ids.js';

function address(value) { return String(value || '').trim().toLowerCase(); }

export class CommsHubEmailService {
  constructor({ context }) { this.context = context; }

  async persistFetched({ uid, parsed, mailbox = 'INBOX' }) {
    if (!this.context.config.emailEnabled) throw new CommsHubError(409, 'email_channel_disabled', 'Email channel is disabled.');
    const sender = address(parsed.from?.address);
    if (!sender) throw new CommsHubError(422, 'email_sender_missing', 'Inbound email has no valid sender.');
    const threadKey = emailThreadKey(parsed);
    const existing = await this.context.operationsRepository.findEmailThread({ accountKey: this.context.config.oneComEmailAccountKey, mailbox, providerThreadKey: threadKey, internetMessageId: parsed.inReplyTo || parsed.messageId });
    const existingConversation = existing?.conversation_id ? await this.context.repository.getConversation(existing.conversation_id) : null;
    const contactId = existingConversation?.contact_id || stableId('con', 'email', sender);
    const conversationId = existing?.conversation_id || stableId('cnv', 'email', this.context.config.oneComEmailAccountKey, threadKey);
    const messageId = stableId('msg', 'email', parsed.messageId);
    const now = new Date().toISOString();
    const managedAddress = this.context.config.emailAddressRoles?.info?.address || this.context.config.oneComEmailAddress;
    const attachmentRows = parsed.attachments.map((item, index) => ({ id: stableId('att', messageId, index, item.filename, item.sha256), filename: item.filename, contentType: item.contentType, status: 'pending', metadata: { size: item.size } }));
    const persistence = await this.context.operationsRepository.persistChannelMessage({
      contact: { id: contactId, primaryEmail: sender, displayName: parsed.from?.name || sender, phone: '' },
      conversation: { id: conversationId, channel: 'email', provider: 'one.com', workflow: 'email_inbox', status: 'open', contactId, subject: parsed.subject, sourceReference: parsed.messageId, metadata: { accountKey: this.context.config.oneComEmailAccountKey, mailbox, threadKey, managedAddress, mailboxRole: 'customer_facing' } },
      message: { id: messageId, direction: 'inbound', sender, recipients: [...parsed.to, ...parsed.cc].map((item) => item.address), subject: parsed.subject, bodyText: parsed.text, bodyHtml: parsed.html, providerMessageId: parsed.messageId, receivedAt: parsed.receivedAt, metadata: { uid, rawSha256: parsed.rawSha256, inReplyTo: parsed.inReplyTo, references: parsed.references, managedAddress, mailboxRole: 'customer_facing' } },
      attachments: attachmentRows,
      at: now,
    });
    await this.context.operationsRepository.ensureConversationOperations(conversationId, 'email-adapter', now);
    await this.context.operationsRepository.upsertEmailThread({ id: stableId('eth', this.context.config.oneComEmailAccountKey, mailbox, threadKey), conversationId, accountKey: this.context.config.oneComEmailAccountKey, mailbox, providerThreadKey: threadKey, internetMessageId: parsed.messageId, references: [...parsed.references, parsed.messageId], lastUid: uid, createdAt: now, metadata: { subject: parsed.subject } });
    await this.context.operationsRepository.addContactAlias({ id: stableId('als', 'email', sender), contactId, type: 'email', value: sender, provider: 'one.com', confidence: 1, verified: true, createdAt: now, metadata: {} });
    const attachmentResults = [];
    for (let index = 0; index < parsed.attachments.length; index += 1) {
      const source = parsed.attachments[index];
      const attachmentId = attachmentRows[index].id;
      try {
        const stored = await this.context.attachmentService.ingest({
          attachmentId,
          filename: source.filename,
          contentType: source.contentType,
          buffer: source.buffer,
          provider: 'one.com',
          metadata: { messageId, conversationId, contactId, channel: 'email', mailbox, managedAddress },
        });
        attachmentResults.push({ attachmentId, status: stored?.quarantined ? 'quarantined' : 'stored' });
      } catch (error) {
        // Preserve the parent email. The attachment service has already written
        // the file to private quarantine before scanning/promotion.
        attachmentResults.push({ attachmentId, status: 'quarantined', error: error?.code || 'attachment_ingest_failed' });
        await this.context.repository.markAttachmentStatus?.(attachmentId, 'quarantined', {
          code: error?.code || 'attachment_ingest_failed',
          failureClass: error?.failureClass || null,
        }).catch?.(() => {});
      }
    }
    await this.context.operationsRepository.indexSearchDocument({
      id: stableId('srch', 'message', messageId),
      objectType: 'message',
      objectId: messageId,
      conversationId,
      contactId,
      channel: 'email',
      searchableText: `${parsed.subject}\n${parsed.text}\n${sender}`,
      metadata: { managedAddress, mailboxRole: 'customer_facing' },
      updatedAt: now,
    });
    if (this.context.config.emailWorkflowEvaluationEnabled) {
      await this.context.workflowEngineService.evaluate({ conversationId, event: { type: 'message_received', channel: 'email', sender, text: parsed.text, occurredAt: now } });
    }
    return { duplicate: persistence.duplicate, conversationId, messageId, workflow: 'email_inbox', managedAddress, attachments: attachmentResults };
  }

  async send({ conversationId, bodyText, bodyHtml = null, subject = '', recipients = [], cc = [], attachments = [], attachmentIds = [], idempotencyKey }) {
    if (!this.context.config.emailEnabled) throw new CommsHubError(409, 'email_channel_disabled', 'Email channel is disabled.');
    if (!idempotencyKey) throw new CommsHubError(400, 'idempotency_key_required', 'Idempotency-Key is required.');
    const conversation = await this.context.repository.getConversation(conversationId);
    if (!conversation || conversation.channel !== 'email') throw new CommsHubError(404, 'email_conversation_not_found', 'Email conversation was not found.');
    const workspace = await this.context.operationsRepository.getConversationWorkspace(conversationId);
    const thread = workspace.emailThread;
    const to = recipients.length ? recipients.map(address).filter(Boolean) : [address(conversation.contact?.primary_email)].filter(Boolean);
    if (!to.length) throw new CommsHubError(422, 'email_recipient_missing', 'Email recipient is missing.');
    const storedAttachments = [];
    for (const attachmentId of [...new Set((attachmentIds || []).map(String))].slice(0, 10)) {
      const item = await this.context.attachmentService.get(attachmentId);
      storedAttachments.push({ filename: item.record.filename, contentType: item.record.content_type, buffer: item.buffer });
    }
    const allAttachments = [...attachments, ...storedAttachments];
    const request = { conversationId, bodyText, bodyHtml, subject: subject || `Re: ${conversation.subject || ''}`, to, cc };
    const attachmentFingerprints = allAttachments.map((item) => ({ filename: item.filename, contentType: item.contentType, sha256: sha256Hex(item.buffer) }));
    const requestSha256 = sha256Hex(JSON.stringify({ ...request, attachments: attachmentFingerprints }));
    const claim = await this.context.operationsRepository.claimChannelOutboundAction({ id: stableId('coa', idempotencyKey), idempotencyKey, conversationId, channel: 'email', actionType: 'reply', requestSha256 });
    if (!claim.acquired) {
      if (claim.duplicate) return { duplicate: true, providerMessageId: claim.existing.provider_message_id };
      throw new CommsHubError(409, 'email_send_in_progress', 'Email send is already in progress.');
    }
    try {
      const references = JSON.parse(thread?.references_json || '[]');
      const sent = await this.context.oneComMail.sendMessage({ to, cc, subject: request.subject, bodyText, bodyHtml, inReplyTo: thread?.internet_message_id || '', references, attachments: allAttachments });
      const at = new Date().toISOString();
      await this.context.operationsRepository.recordOutboundMessage({ id: stableId('msg', 'email-out', sent.messageId), conversationId, sender: this.context.config.oneComEmailAddress, recipients: [...to, ...cc], subject: request.subject, bodyText, bodyHtml, providerMessageId: sent.messageId, receivedAt: at, metadata: { inReplyTo: thread?.internet_message_id || null, references } });
      await this.context.operationsRepository.upsertEmailThread({ id: thread?.id || stableId('eth', conversationId), conversationId, accountKey: this.context.config.oneComEmailAccountKey, mailbox: this.context.config.oneComMailbox, providerThreadKey: thread?.provider_thread_key || conversationId, internetMessageId: sent.messageId, references: [...references, sent.messageId], lastUid: thread?.last_uid || null, createdAt: thread?.created_at || at, metadata: {} });
      await this.context.operationsRepository.completeChannelOutboundAction({ idempotencyKey, providerMessageId: sent.messageId, response: sent, at });
      return { duplicate: false, providerMessageId: sent.messageId };
    } catch (error) {
      await this.context.operationsRepository.failChannelOutboundAction({ idempotencyKey, failureClass: error.failureClass || 'temporary', error: error.message, reconciliationRequired: Boolean(error.retryable) });
      throw error;
    }
  }

  async sendFormResponse({ conversationId, bodyText, bodyHtml = null, subject = '', idempotencyKey }) {
    if (!this.context.config.emailEnabled) throw new CommsHubError(409, 'email_channel_disabled', 'Email channel is disabled.');
    if (!idempotencyKey) throw new CommsHubError(400, 'idempotency_key_required', 'Idempotency-Key is required.');
    const conversation = await this.context.repository.getConversation(conversationId);
    if (!conversation || conversation.channel !== 'form') throw new CommsHubError(404, 'form_conversation_not_found', 'Form conversation was not found.');
    const recipient = address(conversation.contact?.primary_email);
    if (!recipient) throw new CommsHubError(422, 'form_reply_recipient_missing', 'Verified form submission has no reply email address.');
    const request = { conversationId, bodyText, bodyHtml, subject: subject || `Re: ${conversation.subject || 'your submission'}`, to: [recipient] };
    const requestSha256 = sha256Hex(JSON.stringify(request));
    const claim = await this.context.operationsRepository.claimChannelOutboundAction({
      id: stableId('coa', idempotencyKey), idempotencyKey, conversationId, channel: 'form', actionType: 'processed_reply', requestSha256,
    });
    if (!claim.acquired) {
      if (claim.duplicate) return { duplicate: true, providerMessageId: claim.existing.provider_message_id };
      throw new CommsHubError(409, 'form_reply_in_progress', 'Processed form reply is already in progress.');
    }
    try {
      const sent = await this.context.oneComMail.sendMessage({
        to: [recipient],
        subject: request.subject,
        bodyText,
        bodyHtml,
      });
      const at = new Date().toISOString();
      await this.context.operationsRepository.recordOutboundMessage({
        id: stableId('msg', 'form-email-out', sent.messageId),
        conversationId,
        sender: this.context.config.oneComEmailAddress,
        recipients: [recipient],
        subject: request.subject,
        bodyText,
        bodyHtml,
        providerMessageId: sent.messageId,
        receivedAt: at,
        metadata: { deliveryChannel: 'email', sourceChannel: 'form', processedSubmissionReply: true },
      });
      await this.context.operationsRepository.completeChannelOutboundAction({ idempotencyKey, providerMessageId: sent.messageId, response: sent, at });
      return { duplicate: false, providerMessageId: sent.messageId };
    } catch (error) {
      await this.context.operationsRepository.failChannelOutboundAction({
        idempotencyKey, failureClass: error.failureClass || 'temporary', error: error.message, reconciliationRequired: Boolean(error.retryable),
      });
      throw error;
    }
  }

  async sendSystemNotification(notification) {
    const recipient = this.context.config.notificationEmailMap?.[notification.actor] || this.context.config.notificationDefaultEmail;
    if (!recipient) return { skipped: true };
    return this.context.oneComMail.sendMessage({ to: [recipient], subject: `[AIMS Comms Hub] ${notification.title}`, bodyText: notification.body_text, messageId: `${notification.id}@aims.local` });
  }
}
export default CommsHubEmailService;
