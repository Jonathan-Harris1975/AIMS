import { CommsHubError } from './errors.js';
import { sha256Hex, stableId } from './domain/ids.js';
import { safeErrorLog } from './domain/redaction.js';
import { scanPromptInjection } from './domain/promptSecurity.js';
import { log } from '../../logger.js';

function text(value, maximum = 4000) {
  return String(value ?? '').trim().slice(0, maximum);
}

function bool(value) {
  return value === true || String(value || '').toLowerCase() === 'true' || String(value || '') === '1';
}

function safeIso(value) {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : '';
}

function safePage(payload = {}) {
  const page = payload.page && typeof payload.page === 'object' ? payload.page : {};
  return {
    url: text(page.url || payload.pageUrl, 1200),
    title: text(page.title || payload.pageTitle, 300),
    referrer: text(page.referrer || payload.referrer, 1200),
  };
}

export class CommsHubChatService {
  constructor({ context }) { this.context = context; }

  async acceptWebhook(req) {
    if (!this.context.config.chatEnabled) throw new CommsHubError(409, 'chat_channel_disabled', 'Website chat channel is disabled.');
    const verified = await this.context.coginPal.readWebhook(req, this.context.operationsRepository);
    const payload = verified.payload || {};
    const sessionId = text(payload.sessionId || payload.session_id, 200);
    const visitorId = text(payload.visitorId || payload.visitor_id, 200);
    const websiteId = text(payload.websiteId || payload.website_id || 'jonathan-harris.online', 200);
    const rawMessage = String(payload.message?.text ?? payload.text ?? '').trim();
    const requestHuman = bool(payload.requestHuman || payload.request_human);
    if (!sessionId || !visitorId || !rawMessage) throw new CommsHubError(422, 'chat_payload_invalid', 'Chat webhook payload is incomplete.');
    if (rawMessage.length > this.context.config.chatMaxMessageChars) {
      throw new CommsHubError(413, 'chat_message_too_long', 'Website chat message exceeds the configured character limit.', {
        publicMessage: 'That message is too long for web chat.',
      });
    }

    const messageText = rawMessage.slice(0, this.context.config.chatMaxMessageChars);
    const promptSecurity = scanPromptInjection(messageText);
    const promptSecurityMetadata = promptSecurity.detected ? {
      detected: true,
      riskLevel: promptSecurity.riskLevel,
      score: promptSecurity.score,
      reasons: promptSecurity.reasons,
      fingerprint: promptSecurity.fingerprint,
    } : { detected: false };
    const now = new Date().toISOString();
    const contactId = stableId('con', 'chat', websiteId, visitorId);
    const conversationId = stableId('cnv', 'chat', websiteId, sessionId);
    const providerMessageId = text(payload.message?.id || payload.messageId || payload.eventId || verified.nonce, 300);
    const messageId = stableId('msg', 'chat', providerMessageId);
    const page = safePage(payload);

    const since = new Date(Date.now() - 60_000).toISOString();
    const recent = await this.context.operationsRepository.countRecentChatInbound({ conversationId, since });
    if (recent >= this.context.config.chatMaxMessagesPerMinute) {
      throw new CommsHubError(429, 'chat_rate_limited', 'Website chat rate limit exceeded.', {
        retryable: true,
        failureClass: 'temporary',
        publicMessage: 'Too many messages were sent too quickly. Please wait a moment.',
      });
    }

    const persistence = await this.context.operationsRepository.persistChannelMessage({
      contact: {
        id: contactId,
        primaryEmail: text(payload.email, 320),
        displayName: text(payload.name, 200) || `Website visitor ${visitorId.slice(-6)}`,
        phone: '',
      },
      conversation: {
        id: conversationId,
        channel: 'chat',
        provider: 'coginpal',
        workflow: 'website_chat',
        status: 'open',
        contactId,
        subject: 'Website chat',
        sourceReference: sessionId,
        metadata: { websiteId, visitorId, page },
      },
      message: {
        id: messageId,
        direction: 'inbound',
        sender: visitorId,
        recipients: ['website'],
        subject: 'Website chat',
        bodyText: messageText,
        bodyHtml: null,
        providerMessageId,
        receivedAt: safeIso(payload.occurredAt) || now,
        metadata: { payloadSha256: verified.payloadSha256, page, requestHuman, promptSecurity: promptSecurityMetadata },
      },
      at: now,
    });

    await this.context.operationsRepository.ensureConversationOperations(conversationId, 'chat-adapter', now);
    await this.context.operationsRepository.upsertChatSession({
      id: stableId('cht', 'coginpal', websiteId, sessionId),
      conversationId,
      provider: 'coginpal',
      providerSessionId: sessionId,
      websiteId,
      visitorId,
      mode: 'automation',
      assignedActor: null,
      createdAt: now,
      metadata: { page },
    });
    if (requestHuman) {
      await this.context.operationsRepository.updateChatTakeover({ conversationId, mode: 'takeover_requested', actor: null, at: now });
      await this.context.auditService?.record?.({
        actor: 'website-visitor',
        role: 'external',
        action: 'chat_takeover_requested',
        objectType: 'conversation',
        objectId: conversationId,
        conversationId,
        details: { websiteId, sessionIdHash: sha256Hex(sessionId).slice(0, 16) },
      }).catch(() => null);
    }
    await this.context.operationsRepository.addContactAlias({
      id: stableId('als', 'chat', websiteId, visitorId),
      contactId,
      type: 'chat',
      value: visitorId,
      provider: 'coginpal',
      confidence: 1,
      verified: true,
      createdAt: now,
      metadata: { websiteId },
    });
    await this.context.operationsRepository.indexSearchDocument({
      id: stableId('srch', 'message', messageId),
      objectType: 'message',
      objectId: messageId,
      conversationId,
      contactId,
      channel: 'chat',
      searchableText: messageText,
      metadata: { websiteId },
      updatedAt: now,
    });
    if (promptSecurity.detected) {
      await this.context.auditService?.record?.({
        actor: 'system',
        role: 'security',
        action: 'chat_prompt_injection_detected',
        objectType: 'message',
        objectId: messageId,
        conversationId,
        details: {
          riskLevel: promptSecurity.riskLevel,
          score: promptSecurity.score,
          reasons: promptSecurity.reasons,
          fingerprint: promptSecurity.fingerprint,
        },
      }).catch(() => null);
    }
    await this.context.workflowEngineService.evaluate({
      conversationId,
      event: { type: 'message_received', channel: 'chat', sender: visitorId, text: messageText, occurredAt: now },
    });
    if (this.context.config.wakeEnabled) {
      await this.context.wakeClient.requestWake({ eventId: providerMessageId, reason: 'website_chat', source: 'coginpal', receivedAt: now });
    }

    log.info('commsHub.chat.messageAccepted', {
      conversationId,
      duplicate: persistence.duplicate,
      requestHuman,
      transport: this.context.config.coginPalApiBaseUrl ? 'provider_api' : 'aims_first_party',
      promptSecurityRisk: promptSecurity.riskLevel,
    });

    if (!persistence.duplicate && !requestHuman && this.context.config.chatAiWorkflowEnabled && this.context.config.aiEnabled) {
      queueMicrotask(() => void this.runOptionalAutomation(conversationId));
    }

    return { duplicate: persistence.duplicate, conversationId, messageId, takeoverRequested: requestHuman };
  }

  async syncWebhook(req) {
    if (!this.context.config.chatEnabled) throw new CommsHubError(409, 'chat_channel_disabled', 'Website chat channel is disabled.');
    const verified = await this.context.coginPal.readWebhook(req, null);
    const payload = verified.payload || {};
    const sessionId = text(payload.sessionId || payload.session_id, 200);
    const visitorId = text(payload.visitorId || payload.visitor_id, 200);
    const websiteId = text(payload.websiteId || payload.website_id || 'jonathan-harris.online', 200);
    const after = safeIso(payload.after);
    if (!sessionId || !visitorId) throw new CommsHubError(422, 'chat_sync_payload_invalid', 'Chat sync payload is incomplete.');

    const session = await this.context.operationsRepository.getChatSession({ provider: 'coginpal', websiteId, providerSessionId: sessionId });
    if (!session) return { exists: false, messages: [], mode: 'automation', takeoverRequested: false, humanConnected: false };
    if (String(session.visitor_id) !== visitorId) {
      throw new CommsHubError(403, 'chat_session_visitor_mismatch', 'Chat session does not belong to this visitor.', {
        publicMessage: 'This chat session could not be verified.',
      });
    }
    const messages = await this.context.operationsRepository.listChatMessages({
      conversationId: session.conversation_id,
      after,
      limit: this.context.config.chatHistoryLimit,
    });
    return {
      exists: true,
      messages,
      mode: session.mode,
      takeoverRequested: session.mode === 'takeover_requested',
      humanConnected: session.mode === 'human',
      closed: session.mode === 'closed',
    };
  }

  async runOptionalAutomation(conversationId) {
    try {
      const analysis = await this.context.aiWorkflowService.analyseConversation(conversationId, { operation: 'analyse', scheduleFollowUp: false });
      if (!this.context.config.autonomousRepliesEnabled || !analysis?.draft?.id || analysis.draft.requiresApproval) return;
      await this.context.governanceService.attemptAutonomousReply({ conversationId, draftId: analysis.draft.id }, { actor: 'coginpal-automation', role: 'admin' });
      log.info('commsHub.chat.automationSent', { conversationId, draftId: analysis.draft.id });
    } catch (error) {
      const expected = new Set(['autonomous_policy_not_found', 'autonomous_reply_policy_rejected', 'autonomous_replies_disabled']);
      const level = expected.has(error?.code) ? 'info' : 'warn';
      log[level]('commsHub.chat.automationSkipped', { conversationId, error: safeErrorLog(error) });
    }
  }

  async send({ conversationId, message, idempotencyKey }) {
    if (!this.context.config.chatEnabled) throw new CommsHubError(409, 'chat_channel_disabled', 'Website chat channel is disabled.');
    if (!idempotencyKey) throw new CommsHubError(400, 'idempotency_key_required', 'Idempotency-Key is required.');
    const body = String(message ?? '').trim();
    if (!body) throw new CommsHubError(422, 'chat_message_empty', 'Chat reply cannot be empty.');
    if (body.length > this.context.config.chatMaxMessageChars) throw new CommsHubError(413, 'chat_message_too_long', 'Chat reply exceeds the configured character limit.');
    const session = await this.context.operationsRepository.getChatSessionByConversation(conversationId);
    if (!session) throw new CommsHubError(404, 'chat_session_not_found', 'Chat session was not found.');
    if (session.mode === 'closed') throw new CommsHubError(409, 'chat_session_closed', 'Chat session is closed.');
    const requestSha256 = sha256Hex(body);
    const claim = await this.context.operationsRepository.claimChannelOutboundAction({ id: stableId('coa', idempotencyKey), idempotencyKey, conversationId, channel: 'chat', actionType: 'reply', requestSha256 });
    if (!claim.acquired) {
      if (claim.duplicate) return { duplicate: true, providerMessageId: claim.existing.provider_message_id };
      throw new CommsHubError(409, 'chat_send_in_progress', 'Chat send is already in progress.');
    }
    try {
      const localTransport = !this.context.config.coginPalApiBaseUrl;
      const response = localTransport
        ? { id: stableId('cpm', 'aims-first-party', idempotencyKey), transport: 'aims_first_party' }
        : await this.context.coginPal.sendMessage({ sessionId: session.provider_session_id, message: body, idempotencyKey });
      const providerMessageId = String(response.messageId || response.id || stableId('cpm', idempotencyKey));
      const at = new Date().toISOString();
      await this.context.operationsRepository.recordOutboundMessage({
        id: stableId('msg', 'chat-out', providerMessageId),
        conversationId,
        sender: session.assigned_actor || 'AIMS',
        recipients: [session.visitor_id],
        subject: 'Website chat',
        bodyText: body,
        providerMessageId,
        receivedAt: at,
        metadata: { mode: session.mode, transport: localTransport ? 'aims_first_party' : 'provider_api' },
      });
      await this.context.operationsRepository.completeChannelOutboundAction({ idempotencyKey, providerMessageId, response, at });
      log.info('commsHub.chat.replyRecorded', { conversationId, providerMessageId, transport: localTransport ? 'aims_first_party' : 'provider_api' });
      return { duplicate: false, providerMessageId, transport: localTransport ? 'aims_first_party' : 'provider_api' };
    } catch (error) {
      await this.context.operationsRepository.failChannelOutboundAction({ idempotencyKey, failureClass: error.failureClass || 'temporary', error: error.message, reconciliationRequired: Boolean(error.retryable) });
      throw error;
    }
  }

  async takeover({ conversationId, mode, actor }) {
    if (!['takeover_requested', 'human', 'automation', 'closed'].includes(mode)) throw new CommsHubError(400, 'chat_takeover_mode_invalid', 'Chat takeover mode is invalid.');
    const session = await this.context.operationsRepository.updateChatTakeover({ conversationId, mode, actor });
    if (!session) throw new CommsHubError(404, 'chat_session_not_found', 'Chat session was not found.');
    await this.context.auditService?.record?.({ actor: actor || 'system', role: 'operator', action: 'chat_takeover_mode_changed', objectType: 'conversation', objectId: conversationId, conversationId, details: { mode } }).catch(() => null);
    return session;
  }
}
export default CommsHubChatService;
