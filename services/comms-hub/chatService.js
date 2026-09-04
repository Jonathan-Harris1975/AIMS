import { CommsHubError } from './errors.js';
import { sha256Hex, stableId } from './domain/ids.js';
import { safeErrorLog } from './domain/redaction.js';
import { scanPromptInjection } from './domain/promptSecurity.js';
import { assessConversationConduct, conversationInteractionSignals, scanOutboundLanguagePolicy } from './conversationConductService.js';
import { assertConversationReplyAllowed } from './domain/replySafety.js';
import { log } from '../../logger.js';
import { humanContactOffer, humanHandoffStatus, notifyHumanHandoff, proactiveHumanHandoffDecision } from './humanContactService.js';

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

function object(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value || '{}'); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
}

const CHAT_AI_RETRY_INITIAL_DELAY_MS = 5_000;
const CHAT_AI_RETRY_MAX_ATTEMPTS = 4;
const EXPECTED_AUTOMATION_SKIP_CODES = new Set([
  'autonomous_policy_not_found',
  'autonomous_reply_policy_rejected',
  'autonomous_replies_disabled',
  'autonomous_reply_human_assigned',
]);

function recoverableAutomationError(error) {
  if (EXPECTED_AUTOMATION_SKIP_CODES.has(error?.code)) return false;
  return error?.retryable === true
    || error?.code === 'comms_hub_ai_failed'
    || error?.failureClass === 'temporary'
    || error?.failureClass === 'recoverable';
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
    const latestConduct = assessConversationConduct({ messages: [{ id: 'incoming', direction: 'inbound', body_text: messageText }] }, {
      enabled: this.context.config.smartConductEnabled,
      reviewStrikeThreshold: this.context.config.conductReviewStrikeThreshold,
      automationBlockThreshold: this.context.config.conductAutomationBlockThreshold,
    });
    const conductMetadata = latestConduct.level !== 'none' ? {
      level: latestConduct.level,
      targeted: latestConduct.latestTargeted,
      threat: latestConduct.threat,
      reasons: latestConduct.reasons,
    } : { level: 'none' };
    const promptSecurityMetadata = promptSecurity.detected ? {
      detected: true,
      riskLevel: promptSecurity.riskLevel,
      score: promptSecurity.score,
      reasons: promptSecurity.reasons,
      fingerprint: promptSecurity.fingerprint,
    } : { detected: false };
    const nowDate = this.context.now ? new Date(this.context.now()) : new Date();
    const now = nowDate.toISOString();
    const contactId = stableId('con', 'chat', websiteId, visitorId);
    const conversationId = stableId('cnv', 'chat', websiteId, sessionId);
    const providerMessageId = text(payload.message?.id || payload.messageId || payload.eventId || verified.nonce, 300);
    const messageId = stableId('msg', 'chat', providerMessageId);
    const page = safePage(payload);
    const existingSession = await this.context.operationsRepository.getChatSession({ provider: 'coginpal', websiteId, providerSessionId: sessionId });
    const existingSessionMetadata = object(existingSession?.metadata_json);

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
        metadata: { payloadSha256: verified.payloadSha256, page, requestHuman, promptSecurity: promptSecurityMetadata, conduct: conductMetadata },
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
      metadata: { page, callbackEmailOffered: Boolean(requestHuman || existingSessionMetadata.callbackEmailOffered) },
    });
    const handoff = humanHandoffStatus(this.context.config, nowDate);
    if (requestHuman && handoff.available) {
      await this.context.operationsRepository.updateChatTakeover({ conversationId, mode: 'takeover_requested', actor: null, at: now });
      await this.context.auditService?.record?.({
        actor: 'website-visitor',
        role: 'external',
        action: 'chat_takeover_requested',
        objectType: 'conversation',
        objectId: conversationId,
        conversationId,
        details: { websiteId, sessionIdHash: sha256Hex(sessionId).slice(0, 16), businessHoursAvailable: handoff.available },
      }).catch(() => null);
      await this.context.notificationService?.create?.({
        actor: 'admin', conversationId, type: 'human_handoff_requested', title: 'Website visitor requested Jonathan',
        bodyText: "A website visitor requested a live hand-off during Jonathan's published hand-off hours.",
        severity: 'critical', emailRequested: true, idempotencySeed: `chat-handoff:${messageId}`,
      }).catch(() => null);
    } else if (requestHuman) {
      await this.context.auditService?.record?.({
        actor: 'website-visitor', role: 'external', action: 'chat_handoff_deferred_outside_business_hours',
        objectType: 'conversation', objectId: conversationId, conversationId,
        details: { nextAvailableAt: handoff.nextAvailableAt, timeZone: handoff.timeZone },
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
    const callbackAlias = null;
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
    let conversationConduct = latestConduct;
    if (this.context.config.smartConductEnabled && this.context.repository?.getConversation) {
      try {
        const persistedConversation = await this.context.repository.getConversation(conversationId);
        if (persistedConversation) conversationConduct = assessConversationConduct(persistedConversation, {
          enabled: true,
          reviewStrikeThreshold: this.context.config.conductReviewStrikeThreshold,
          automationBlockThreshold: this.context.config.conductAutomationBlockThreshold,
        });
      } catch {}
    }
    if (conversationConduct.level !== 'none') {
      await this.context.auditService?.record?.({
        actor: 'system',
        role: 'security',
        action: 'chat_conduct_flagged',
        objectType: 'message',
        objectId: messageId,
        conversationId,
        details: {
          level: conversationConduct.level,
          strikeCount: conversationConduct.strikeCount,
          targetedCount: conversationConduct.targetedCount,
          threat: conversationConduct.threat,
          requiresHumanReview: conversationConduct.requiresHumanReview,
          automationBlocked: conversationConduct.automationBlocked,
          reasons: conversationConduct.reasons,
        },
      }).catch(() => null);
    }
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
    if (!persistence.duplicate && requestHuman) {
      const message = humanContactOffer({ handoff, available: handoff.available, contactUrl: this.context.config.jotformForms?.contact?.url || '' });
      await this.send({ conversationId, message, idempotencyKey: `chat-human-contact:${messageId}` }).catch((error) => {
        log.warn('commsHub.chat.humanContactOfferFailed', { conversationId, error: safeErrorLog(error) });
      });
    }

    log.info('commsHub.chat.messageAccepted', {
      conversationId,
      duplicate: persistence.duplicate,
      requestHuman,
      handoffAvailable: handoff.available,
      callbackEmailCaptured: false,
      transport: this.context.config.coginPalApiBaseUrl ? 'provider_api' : 'aims_first_party',
      promptSecurityRisk: promptSecurity.riskLevel,
      conductLevel: conversationConduct.level,
      conductAutomationBlocked: conversationConduct.automationBlocked,
    });

    if (!persistence.duplicate && !requestHuman && !conversationConduct.automationBlocked && this.context.config.chatAiWorkflowEnabled && this.context.config.aiEnabled) {
      queueMicrotask(() => void this.runOptionalAutomation(conversationId, { triggerMessageId: messageId }));
    }

    return { duplicate: persistence.duplicate, conversationId, messageId, takeoverRequested: Boolean(requestHuman && handoff.available), handoffAvailable: handoff.available,
       nextHandoffAt: handoff.nextAvailableAt, callbackEmailCaptured: false, emailCaptureOffered: false, contactFormUrl: requestHuman && !handoff.available ? (
         this.context.config.jotformForms?.contact?.url || null) : null };
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
    if (!session) { const handoff = humanHandoffStatus(this.context.config, this.context.now ? new Date(this.context.now()) : new Date()); return { exists: false, messages: [],
       mode: 'automation', takeoverRequested: false, humanConnected: false, handoffAvailable: handoff.available, nextHandoffAt: handoff.nextAvailableAt }; }
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
    const handoff = humanHandoffStatus(this.context.config, this.context.now ? new Date(this.context.now()) : new Date());
    return {
      exists: true,
      messages,
      mode: session.mode,
      takeoverRequested: session.mode === 'takeover_requested',
      humanConnected: session.mode === 'human',
      closed: session.mode === 'closed',
      handoffAvailable: handoff.available,
      nextHandoffAt: handoff.nextAvailableAt,
    };
  }

  async scheduleAutomationRetry(conversationId, triggerMessageId, error) {
    const now = this.context.now ? new Date(this.context.now()) : new Date();
    const dueAt = new Date(now.getTime() + CHAT_AI_RETRY_INITIAL_DELAY_MS).toISOString();
    const retryKey = `chat-ai-retry:${conversationId}:${text(triggerMessageId, 200) || 'latest'}`;
    const action = await this.context.operationsRepository.scheduleDelayedAction({
      id: stableId('dla', retryKey),
      conversationId,
      actionType: 'chat_ai_retry',
      payload: { triggerMessageId: text(triggerMessageId, 200) || null },
      dueAt,
      maxAttempts: CHAT_AI_RETRY_MAX_ATTEMPTS,
      idempotencyKey: retryKey,
      actor: 'coginpal-automation',
      createdAt: now.toISOString(),
    });
    log.warn('commsHub.chat.automationRetryScheduled', {
      conversationId,
      delayedActionId: action?.id || null,
      dueAt,
      error: safeErrorLog(error),
    });
    return action;
  }

  async applyProactiveHumanRouting(conversationId, analysis, { triggerMessageId = '' } = {}) {
    const conversation = await this.context.repository.getConversation(conversationId);
    if (!conversation) return { routed: false };
    const handoff = humanHandoffStatus(this.context.config, this.context.now ? new Date(this.context.now()) : new Date());
    const conduct = assessConversationConduct(conversation, {
      enabled: this.context.config.smartConductEnabled,
      reviewStrikeThreshold: this.context.config.conductReviewStrikeThreshold,
      automationBlockThreshold: this.context.config.conductAutomationBlockThreshold,
    });
    const interactionSignals = conversationInteractionSignals(conversation);
    const decision = proactiveHumanHandoffDecision({
      handoff,
      responseIntelligence: analysis?.responseIntelligence || {},
      strategy: analysis?.strategy || {},
      interactionSignals,
      explicitRequest: interactionSignals.humanRequestCount > 0,
      conduct,
    });
    if (!decision.needed) return { routed: false, decision };
    if (decision.requestLiveHandoff) {
      await this.context.operationsRepository.updateChatTakeover({ conversationId, mode: 'takeover_requested', actor: null, at: new Date().toISOString() });
      await notifyHumanHandoff({ context: this.context, conversationId, reason: decision.reason, idempotencySeed: `proactive-handoff:${conversationId}:${triggerMessageId ||
         'latest'}` }).catch(() => null);
      await this.context.auditService?.record?.({ actor: 'coginpal-automation', role: 'operator', action: 'chat_proactive_handoff_requested', objectType: 'conversation',
         objectId: conversationId, conversationId, details: { reason: decision.reason } }).catch(() => null);
      return { routed: true, mode: 'takeover_requested', decision };
    }
    if (decision.offerContactForm) {
      const contactUrl = this.context.config.jotformForms?.contact?.url || '';
      const message = humanContactOffer({ available: false, contactUrl });
      await this.send({ conversationId, message, idempotencyKey: `chat-proactive-contact:${triggerMessageId || conversationId}` });
      await this.context.auditService?.record?.({ actor: 'coginpal-automation', role: 'operator', action: 'chat_out_of_hours_contact_form_offered', objectType: 'conversation',
         objectId: conversationId, conversationId, details: { reason: decision.reason, contactUrlConfigured: Boolean(contactUrl) } }).catch(() => null);
      return { routed: true, mode: 'contact_form', decision };
    }
    return { routed: true, mode: 'review_only', decision };
  }

  async runOptionalAutomation(conversationId, { triggerMessageId = '', scheduleRetry = true, rethrowRecoverable = false } = {}) {
    try {
      const operations = await this.context.operationsRepository.getConversationOperations(conversationId);
      if (operations?.owner_type === 'person') {
        log.info('commsHub.chat.automationSkipped', { conversationId, reason: 'human_assigned' });
        return { skipped: true, reason: 'human_assigned' };
      }
      const analysis = await this.context.aiWorkflowService.analyseConversation(conversationId, { operation: 'analyse', scheduleFollowUp: false });
      const humanRouting = await this.applyProactiveHumanRouting(conversationId, analysis, { triggerMessageId });
      if (humanRouting.routed) return { skipped: true, reason: `human_routing:${humanRouting.mode}`, humanRouting, analysis };
      if (!this.context.config.autonomousRepliesEnabled || !analysis?.draft?.id || analysis.draft.requiresApproval) {
        return { skipped: true, reason: analysis?.draft?.requiresApproval ? 'approval_required' : 'autonomous_reply_unavailable' };
      }
      await this.context.governanceService.attemptAutonomousReply({ conversationId, draftId: analysis.draft.id }, { actor: 'coginpal-automation', role: 'admin' });
      log.info('commsHub.chat.automationSent', { conversationId, draftId: analysis.draft.id });
      return { sent: true, draftId: analysis.draft.id };
    } catch (error) {
      const expected = EXPECTED_AUTOMATION_SKIP_CODES.has(error?.code);
      let retryScheduled = false;
      if (!expected && scheduleRetry && recoverableAutomationError(error)) {
        try {
          await this.scheduleAutomationRetry(conversationId, triggerMessageId, error);
          retryScheduled = true;
        } catch (retryError) {
          log.error('commsHub.chat.automationRetryScheduleFailed', {
            conversationId,
            error: safeErrorLog(retryError),
            originalError: safeErrorLog(error),
          });
        }
      }
      const level = expected ? 'info' : 'warn';
      log[level]('commsHub.chat.automationSkipped', { conversationId, retryScheduled, error: safeErrorLog(error) });
      if (rethrowRecoverable && !expected && recoverableAutomationError(error)) throw error;
      return { skipped: true, retryScheduled, reason: error?.code || 'automation_failed' };
    }
  }

  async send({ conversationId, message, idempotencyKey }) {
    if (!this.context.config.chatEnabled) throw new CommsHubError(409, 'chat_channel_disabled', 'Website chat channel is disabled.');
    if (!idempotencyKey) throw new CommsHubError(400, 'idempotency_key_required', 'Idempotency-Key is required.');
    const body = String(message ?? '').trim();
    if (!body) throw new CommsHubError(422, 'chat_message_empty', 'Chat reply cannot be empty.');
    if (body.length > this.context.config.chatMaxMessageChars) throw new CommsHubError(413, 'chat_message_too_long', 'Chat reply exceeds the configured character limit.');
    if (this.context.config.badLanguageBlockEnabled) {
      const language = scanOutboundLanguagePolicy(body);
      if (language.detected) throw new CommsHubError(422, 'chat_reply_language_policy_rejected', 'Chat reply contains blocked language.', {
        failureClass: 'permanent',
        publicMessage: 'That reply contains language blocked by the Communications Hub policy.',
      });
    }
    const [session, conversation, operations] = await Promise.all([
      this.context.operationsRepository.getChatSessionByConversation(conversationId),
      this.context.repository.getConversation(conversationId),
      this.context.operationsRepository.getConversationOperations(conversationId),
    ]);
    if (!session) throw new CommsHubError(404, 'chat_session_not_found', 'Chat session was not found.');
    if (!conversation || conversation.channel !== 'chat') throw new CommsHubError(404, 'chat_conversation_not_found', 'Website chat conversation was not found.');
    if (session.mode === 'closed') throw new CommsHubError(409, 'chat_session_closed', 'Chat session is closed.');
    assertConversationReplyAllowed({ conversation, operations });
    const requestSha256 = sha256Hex(body);
    const claim = await this.context.operationsRepository.claimChannelOutboundAction({ id: stableId('coa', idempotencyKey), idempotencyKey, conversationId, channel: 'chat',
       actionType: 'reply', requestSha256 });
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
      await this.context.operationsRepository.failChannelOutboundAction({ idempotencyKey, failureClass: error.failureClass || 'temporary', error: error.message,
         reconciliationRequired: Boolean(error.retryable) });
      throw error;
    }
  }

  async takeover({ conversationId, mode, actor }) {
    if (!['takeover_requested', 'human', 'automation', 'closed'].includes(mode)) throw new CommsHubError(400, 'chat_takeover_mode_invalid', 'Chat takeover mode is invalid.');
    if (['takeover_requested', 'human'].includes(mode)) {
      const handoff = humanHandoffStatus(this.context.config, this.context.now ? new Date(this.context.now()) : new Date());
      if (!handoff.available) throw new CommsHubError(409, 'chat_handoff_outside_business_hours', 'Human hand-off is available only during configured business hours.', {
        publicMessage: `Jonathan is available for live hand-off Monday to Friday between 09:00 and 17:00 UK time. Outside those hours, please use the Contact Me form:\
 ${this.context.config.jotformForms?.contact?.url || 'https://jonathan-harris.online/'}`,
        details: { nextAvailableAt: handoff.nextAvailableAt, timeZone: handoff.timeZone },
      });
    }
    const session = await this.context.operationsRepository.updateChatTakeover({ conversationId, mode, actor });
    if (!session) throw new CommsHubError(404, 'chat_session_not_found', 'Chat session was not found.');
    await this.context.auditService?.record?.({ actor: actor || 'system', role: 'operator', action: 'chat_takeover_mode_changed', objectType: 'conversation', objectId:
       conversationId, conversationId, details: { mode } }).catch(() => null);
    return session;
  }
}
export default CommsHubChatService;
