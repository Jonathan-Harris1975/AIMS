import { CommsHubError } from './errors.js';
import { emailThreadKey } from './domain/email.js';
import { sha256Hex, stableId } from './domain/ids.js';
import { scanOutboundLanguagePolicy } from './conversationConductService.js';
import { assertConversationReplyAllowed } from './domain/replySafety.js';
import { businessHoursPolicy, conversationFirstInboundAt, delayedBusinessReplyAt, ensureFutureBusinessTime, hasOutboundMessages } from './domain/businessHours.js';
import { kickInboundConversationAutomation } from "./inboundAutomationService.js";
import { isAutomationExcludedEmailAccountKey } from './domain/automationScope.js';

function address(value) { return String(value || '').trim().toLowerCase(); }


function resolveEmailAccount(context, accountKey = 'info') {
  const key = String(accountKey || 'info').trim().toLowerCase();
  if (isAutomationExcludedEmailAccountKey(key)) {
    throw new CommsHubError(409, 'email_mailbox_automation_excluded', `${key} is outside Comms Hub automation.`, {
      failureClass: 'permanent',
      publicMessage: 'This mailbox is intentionally outside AIMS Communications Hub automation.',
    });
  }
  const accounts = context?.config?.emailAccounts || null;
  if (accounts && Object.keys(accounts).length) {
    const account = accounts[key];
    if (account) return account;
    throw new CommsHubError(404, 'email_account_not_configured', `Email account ${key || 'unknown'} is not configured for Comms Hub.`);
  }
  if (key !== String(context.config.oneComEmailAccountKey || 'info').trim().toLowerCase()) {
    throw new CommsHubError(404, 'email_account_not_configured', `Email account ${key || 'unknown'} is not configured for Comms Hub.`);
  }
  return {
    key: context.config.oneComEmailAccountKey || 'info',
    enabled: context.config.emailEnabled,
    address: context.config.oneComEmailAddress,
    username: context.config.oneComEmailUsername,
    password: context.config.oneComEmailPassword,
    mailbox: context.config.oneComMailbox,
    mailboxRole: 'customer_facing',
    manualOnly: false,
    workflowEvaluationEnabled: context.config.emailWorkflowEvaluationEnabled,
  };
}

function emailClientFor(context, account) {
  return context.oneComMailAccounts?.[account.key] || context.oneComMail;
}

function validateReplyBody(context, bodyText, bodyHtml) {
  const text = String(bodyText ?? '').trim();
  const html = String(bodyHtml ?? '').trim();
  if (!text && !html) throw new CommsHubError(422, 'email_reply_empty', 'Email reply cannot be empty.');
  const maximum = Number(context?.config?.emailMaxReplyChars || 20_000);
  if (text.length > maximum || html.length > maximum * 4) {
    throw new CommsHubError(413, 'email_reply_too_long', 'Email reply exceeds the configured character limit.');
  }
  if (context?.config?.badLanguageBlockEnabled) {
    const language = scanOutboundLanguagePolicy(`${text}\n${html}`);
    if (language.detected) throw new CommsHubError(422, 'email_reply_language_policy_rejected', 'Email reply contains blocked language.', {
      failureClass: 'permanent',
      publicMessage: 'That reply contains language blocked by the Communications Hub policy.',
    });
  }
}


function businessReplyDueAt(context, conversation, seed) {
  const policy = businessHoursPolicy(context.config);
  const target = delayedBusinessReplyAt({
    receivedAt: conversationFirstInboundAt(conversation),
    seed,
    ...policy,
    minimumDays: context.config.replyDelayMinDays,
    maximumDays: context.config.replyDelayMaxDays,
  });
  const now = typeof context.now === 'function' ? context.now() : new Date();
  return ensureFutureBusinessTime(target, policy, now).toISOString();
}

async function scheduleBusinessReply(context, { conversation, actionType, payload, idempotencyKey, seed }) {
  const dueAt = businessReplyDueAt(context, conversation, seed || idempotencyKey);
  const action = await context.workflowEngineService.schedule({
    conversationId: conversation.id,
    actionType,
    dueAt,
    payload,
    idempotencyKey: `business-reply:${idempotencyKey}`,
    maxAttempts: 8,
  }, { actor: 'business-reply-scheduler', role: 'admin' });
  return { scheduled: true, dueAt: action?.due_at || dueAt, delayedActionId: action?.id || null };
}

function assertConversationReplyRecipients(context, conversation, recipients = [], cc = []) {
  const primary = address(conversation?.contact?.primary_email);
  const requestedTo = [...new Set((recipients || []).map(address).filter(Boolean))];
  const requestedCc = [...new Set((cc || []).map(address).filter(Boolean))];
  if (context?.config?.emailExternalRecipientsEnabled === true) {
    return { to: requestedTo.length ? requestedTo : [primary].filter(Boolean), cc: requestedCc };
  }
  if (requestedCc.length) {
    throw new CommsHubError(403, 'email_external_recipient_blocked', 'Conversation replies cannot add CC recipients while external-recipient mode is disabled.', {
      failureClass: 'permanent',
      publicMessage: 'Additional recipients are disabled for conversation replies.',
    });
  }
  if (requestedTo.some((item) => item !== primary)) {
    throw new CommsHubError(403, 'email_external_recipient_blocked', 'Conversation replies may only be sent to the verified conversation email address.', {
      failureClass: 'permanent',
      publicMessage: 'This reply can only be sent to the conversation contact.',
    });
  }
  return { to: [primary].filter(Boolean), cc: [] };
}

export class CommsHubEmailService {
  constructor({ context }) { this.context = context; }

  async persistFetched({ uid, parsed, mailbox = 'INBOX', accountKey = 'info', managedAddress = '', mailboxRole = '', automationEnabled = null }) {
    if (!this.context.config.emailEnabled) throw new CommsHubError(409, 'email_channel_disabled', 'Email channel is disabled.');
    const sender = address(parsed.from?.address);
    if (!sender) throw new CommsHubError(422, 'email_sender_missing', 'Inbound email has no valid sender.');
    const account = resolveEmailAccount(this.context, accountKey);
    if (!account.enabled) throw new CommsHubError(409, 'email_mailbox_disabled', `Email mailbox ${account.key} is disabled.`);
    const effectiveManagedAddress = address(managedAddress) || account.address;
    const effectiveMailboxRole = String(mailboxRole || account.mailboxRole || 'customer_facing');
    const evaluateWorkflow = automationEnabled === null ? account.workflowEvaluationEnabled === true : automationEnabled === true;
    const threadKey = emailThreadKey(parsed);
    const existing = await this.context.operationsRepository.findEmailThread({ accountKey: account.key, mailbox, providerThreadKey: threadKey, internetMessageId:
       parsed.inReplyTo || parsed.messageId });
    const existingConversation = existing?.conversation_id ? await this.context.repository.getConversation(existing.conversation_id) : null;
    const contactId = existingConversation?.contact_id || stableId('con', 'email', sender);
    const conversationId = existing?.conversation_id || stableId('cnv', 'email', account.key, threadKey);
    const messageId = stableId('msg', 'email', parsed.messageId);
    const now = new Date().toISOString();
    const outreachReply = existingConversation?.workflow === 'outreach_guest_article';
    const attachmentRows = parsed.attachments.map((item, index) => ({ id: stableId('att', messageId, index, item.filename, item.sha256), filename: item.filename, contentType:
       item.contentType, status: 'pending', metadata: { size: item.size } }));
    const persistence = await this.context.operationsRepository.persistChannelMessage({
      contact: { id: contactId, primaryEmail: sender, displayName: parsed.from?.name || sender, phone: '' },
      conversation: { id: conversationId, channel: 'email', provider: 'one.com', workflow: outreachReply ? 'outreach_guest_article' : 'email_inbox', status: 'open', contactId,
         subject: parsed.subject, sourceReference: parsed.messageId, metadata: outreachReply ? { ...(existingConversation?.metadata || {}), accountKey: account.key, mailbox,
            threadKey, managedAddress: effectiveManagedAddress, mailboxRole: effectiveMailboxRole, manualOnly: account.manualOnly === true, outreachReply: true } : {
               accountKey: account.key, mailbox, threadKey, managedAddress: effectiveManagedAddress, mailboxRole: effectiveMailboxRole, manualOnly: account.manualOnly === true } },
      message: { id: messageId, direction: 'inbound', sender, recipients: [...parsed.to, ...parsed.cc].map((item) => item.address), subject: parsed.subject, bodyText:
         parsed.text, bodyHtml: parsed.html, providerMessageId: parsed.messageId, receivedAt: parsed.receivedAt, metadata: { uid, rawSha256: parsed.rawSha256, inReplyTo:
            parsed.inReplyTo, references: parsed.references, managedAddress: effectiveManagedAddress, mailboxRole: effectiveMailboxRole, manualOnly: account.manualOnly === true } },
      attachments: attachmentRows,
      at: now,
    });
    await this.context.operationsRepository.ensureConversationOperations(conversationId, 'email-adapter', now);
    await this.context.operationsRepository.upsertEmailThread({ id: stableId('eth', account.key, mailbox, threadKey), conversationId, accountKey: account.key, mailbox,
       providerThreadKey: threadKey, internetMessageId: parsed.messageId, references: [...parsed.references, parsed.messageId], lastUid: uid, createdAt: now, metadata: { subject: parsed.subject } });
    await this.context.operationsRepository.addContactAlias({ id: stableId('als', 'email', sender), contactId, type: 'email', value: sender, provider: 'one.com', confidence: 1,
       verified: true, createdAt: now, metadata: {} });
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
          metadata: { messageId, conversationId, contactId, channel: 'email', mailbox, managedAddress: effectiveManagedAddress, accountKey: account.key, mailboxRole: effectiveMailboxRole },
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
      metadata: { managedAddress: effectiveManagedAddress, mailboxRole: effectiveMailboxRole, accountKey: account.key },
      updatedAt: now,
    });
    if (outreachReply && !persistence.duplicate) {
      await this.context.outreachAutomationService?.scheduleReplyProcessing(conversationId, messageId);
    } else {
      if (evaluateWorkflow) {
        await this.context.workflowEngineService.evaluate({ conversationId, event: { type: 'message_received', channel: 'email', sender, text: parsed.text, occurredAt: now } });
      }
      if (!persistence.duplicate && evaluateWorkflow) {
        kickInboundConversationAutomation({
          context: this.context,
          conversationId,
          actor: 'email-inbound-automation',
          scheduleFollowUp: true,
          blockedReason: parsed.attachments.length ? 'attachment_review_required' : '',
        });
      }
    }
    return { duplicate: persistence.duplicate, conversationId, messageId, workflow: outreachReply ? 'outreach_guest_article' : 'email_inbox', accountKey: account.key,
       managedAddress: effectiveManagedAddress, mailboxRole: effectiveMailboxRole, manualOnly: account.manualOnly === true, attachments: attachmentResults };
  }

  async send({ conversationId, bodyText, bodyHtml = null, subject = '', recipients = [], cc = [], attachments = [], attachmentIds = [], idempotencyKey, scheduledDelivery =
     false, manualReply = false }) {
    if (!this.context.config.emailEnabled) throw new CommsHubError(409, 'email_channel_disabled', 'Email channel is disabled.');
    if (!idempotencyKey) throw new CommsHubError(400, 'idempotency_key_required', 'Idempotency-Key is required.');
    const conversation = await this.context.repository.getConversation(conversationId);
    if (!conversation || conversation.channel !== 'email') throw new CommsHubError(404, 'email_conversation_not_found', 'Email conversation was not found.');
    validateReplyBody(this.context, bodyText, bodyHtml);
    const workspace = await this.context.operationsRepository.getConversationWorkspace(conversationId);
    assertConversationReplyAllowed({ conversation, operations: workspace.operations });
    const thread = workspace.emailThread;
    const account = resolveEmailAccount(this.context, thread?.account_key || 'info');
    if (!account.enabled) throw new CommsHubError(409, 'email_mailbox_disabled', `Email mailbox ${account.key} is disabled.`);
    if (account.manualOnly && manualReply !== true) {
      throw new CommsHubError(409, 'email_mailbox_manual_only', `${account.address} is a manual-reply-only inbox.`, {
        failureClass: 'permanent',
        publicMessage: 'This inbox only allows an operator to send replies manually.',
      });
    }
    const mailClient = emailClientFor(this.context, account);
    const { to, cc: safeCc } = assertConversationReplyRecipients(this.context, conversation, recipients, cc);
    if (!to.length) throw new CommsHubError(422, 'email_recipient_missing', 'Email recipient is missing.');
    if (!scheduledDelivery && this.context.config.emailInitialReplyDelayEnabled && !hasOutboundMessages(conversation)) {
      if ((attachments || []).length) {
        throw new CommsHubError(422, 'email_initial_reply_inline_attachment_requires_storage', 'Delayed initial email replies require stored attachment IDs rather than inline attachment buffers.', {
          failureClass: 'permanent',
          publicMessage: 'Upload reply attachments to Comms Hub before scheduling the initial response.',
        });
      }
      return scheduleBusinessReply(this.context, {
        conversation,
        actionType: 'email_reply',
        idempotencyKey,
        seed: `${conversation.id}:initial-email-reply`,
        payload: { conversationId, bodyText, bodyHtml, subject, recipients: to, cc: safeCc, attachmentIds, idempotencyKey, manualReply },
      });
    }
    const storedAttachments = [];
    for (const attachmentId of [...new Set((attachmentIds || []).map(String))].slice(0, 10)) {
      const item = await this.context.attachmentService.get(attachmentId);
      storedAttachments.push({ filename: item.record.filename, contentType: item.record.content_type, buffer: item.buffer });
    }
    const allAttachments = [...attachments, ...storedAttachments];
    const request = { conversationId, bodyText, bodyHtml, subject: subject || `Re: ${conversation.subject || ''}`, to, cc: safeCc };
    const attachmentFingerprints = allAttachments.map((item) => ({ filename: item.filename, contentType: item.contentType, sha256: sha256Hex(item.buffer) }));
    const requestSha256 = sha256Hex(JSON.stringify({ ...request, attachments: attachmentFingerprints }));
    const claim = await this.context.operationsRepository.claimChannelOutboundAction({ id: stableId('coa', idempotencyKey), idempotencyKey, conversationId, channel: 'email',
       actionType: 'reply', requestSha256 });
    if (!claim.acquired) {
      if (claim.duplicate) return { duplicate: true, providerMessageId: claim.existing.provider_message_id };
      throw new CommsHubError(409, 'email_send_in_progress', 'Email send is already in progress.');
    }
    try {
      const references = JSON.parse(thread?.references_json || '[]');
      const sent = await mailClient.sendMessage({ to, cc: safeCc, subject: request.subject, bodyText, bodyHtml, inReplyTo: thread?.internet_message_id || '', references,
         attachments: allAttachments });
      const at = new Date().toISOString();
      await this.context.operationsRepository.recordOutboundMessage({ id: stableId('msg', 'email-out', sent.messageId), conversationId, sender: account.address, recipients: [
        ...to, ...safeCc], subject: request.subject, bodyText, bodyHtml, providerMessageId: sent.messageId, receivedAt: at, metadata: { inReplyTo: thread?.internet_message_id || null, references } });
      await this.context.operationsRepository.upsertEmailThread({ id: thread?.id || stableId('eth', conversationId), conversationId, accountKey: account.key, mailbox:
         account.mailbox, providerThreadKey: thread?.provider_thread_key || conversationId, internetMessageId: sent.messageId, references: [...references, sent.messageId],
            lastUid: thread?.last_uid || null, createdAt: thread?.created_at || at, metadata: {} });
      await this.context.operationsRepository.completeChannelOutboundAction({ idempotencyKey, providerMessageId: sent.messageId, response: sent, at });
      return { duplicate: false, providerMessageId: sent.messageId };
    } catch (error) {
      await this.context.operationsRepository.failChannelOutboundAction({ idempotencyKey, failureClass: error.failureClass || 'temporary', error: error.message,
         reconciliationRequired: Boolean(error.retryable) });
      throw error;
    }
  }

  async sendFormResponse({ conversationId, bodyText, bodyHtml = null, subject = '', idempotencyKey, scheduledDelivery = false }) {
    if (!this.context.config.emailEnabled) throw new CommsHubError(409, 'email_channel_disabled', 'Email channel is disabled.');
    if (!idempotencyKey) throw new CommsHubError(400, 'idempotency_key_required', 'Idempotency-Key is required.');
    const conversation = await this.context.repository.getConversation(conversationId);
    if (!conversation || conversation.channel !== 'form') throw new CommsHubError(404, 'form_conversation_not_found', 'Form conversation was not found.');
    validateReplyBody(this.context, bodyText, bodyHtml);
    const operations = await this.context.operationsRepository.getConversationOperations(conversationId);
    assertConversationReplyAllowed({ conversation, operations });
    const recipient = address(conversation.contact?.primary_email);
    if (!recipient) throw new CommsHubError(422, 'form_reply_recipient_missing', 'Verified form submission has no reply email address.');
    if (!scheduledDelivery && this.context.config.formReplyDelayEnabled && !hasOutboundMessages(conversation)) {
      return scheduleBusinessReply(this.context, {
        conversation,
        actionType: 'form_reply',
        idempotencyKey,
        seed: `${conversation.id}:jotform-processed-reply`,
        payload: { conversationId, bodyText, bodyHtml, subject, idempotencyKey },
      });
    }
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
