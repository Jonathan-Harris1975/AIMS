import { CommsHubError } from './errors.js';
import { stableId } from './domain/ids.js';
import { sendReplyDraft } from './replyDraftService.js';
import { resolveConversationAutomationExclusion } from './domain/automationScope.js';

function cleanKey(value) { return String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '_').slice(0, 80); }

function finiteNumber(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function riskLevelFloor(value) {
  switch (String(value || '').trim().toLowerCase()) {
    case 'low': return 0;
    case 'medium': return 0.25;
    case 'high': return 0.65;
    case 'critical': return 1;
    default: return null;
  }
}

export function resolveAutonomousAssessment(ai = {}) {
  const state = ai?.state || ai || {};
  const latestRun = Array.isArray(ai?.runs) ? ai.runs[0] || {} : {};
  const confidence = finiteNumber(state.intent_confidence)
    ?? finiteNumber(latestRun.intent_confidence)
    ?? finiteNumber(state.confidence)
    ?? 0;
  const riskCandidates = [
    finiteNumber(state.risk_score),
    finiteNumber(latestRun.reputational_risk),
    riskLevelFloor(state.risk_level || latestRun.risk_level),
  ].filter((value) => value !== null);
  const risk = riskCandidates.length ? Math.max(...riskCandidates) : 1;
  return { risk, confidence };
}

export class CommsHubGovernanceService {
  constructor({ context }) { this.context = context; }

  async upsertAutonomousPolicy(input, identity) {
    const key = cleanKey(input.key);
    if (!key) throw new CommsHubError(400, 'autonomous_policy_key_invalid', 'Autonomous policy key is required.');
    const status = String(input.status || 'draft').toLowerCase();
    if (!['draft', 'active', 'disabled'].includes(status)) throw new CommsHubError(400, 'autonomous_policy_status_invalid', 'Autonomous policy status is invalid.');
    if (status === 'active' && identity.role !== 'admin' && identity.role !== 'reviewer') throw new CommsHubError(403, 'autonomous_policy_approval_denied',
       'Only a reviewer or administrator may activate autonomous replies.');
    const createdAt = new Date().toISOString();
    const policy = await this.context.operationsRepository.upsertAutonomousPolicy({ id: stableId('arp', key), key, channel: String(input.channel || 'any'), intent: String(
      input.intent || 'any'), maximumRisk: Number(input.maximumRisk ?? 0.15), minimumConfidence: Number(input.minimumConfidence ?? 0.9), requireEvidence:
         input.requireEvidence !== false, allowedHours: input.allowedHours || {}, maximumPerHour: Math.min(Math.max(Number(input.maximumPerHour) || 1, 1), 50), status, actor:
            identity.actor, approvedBy: status === 'active' ? identity.actor : null, createdAt });
    await this.context.auditService.record({ actor: identity.actor, role: identity.role, action: 'autonomous_policy_upserted', objectType: 'autonomous_policy', objectId: policy.id, after: policy });
    return policy;
  }

  async attemptAutonomousReply({ conversationId, draftId }, identity = { actor: 'autonomous-worker', role: 'admin' }) {
    if (!this.context.config.autonomousRepliesEnabled) throw new CommsHubError(409, 'autonomous_replies_disabled', 'Autonomous replies are disabled.');
    const operationsPromise = this.context.operationsRepository?.getConversationOperations
      ? this.context.operationsRepository.getConversationOperations(conversationId)
      : Promise.resolve(null);
    const [conversation, ai, draft, operations] = await Promise.all([this.context.repository.getConversation(conversationId), this.context.aiRepository.getConversationAiState(
      conversationId), this.context.aiRepository.getDraft(draftId), operationsPromise]);
    if (!conversation || !draft || draft.conversation_id !== conversationId) throw new CommsHubError(404, 'autonomous_reply_target_missing', 'Conversation or reply draft was not found.');
    const automationExclusion = await resolveConversationAutomationExclusion(this.context, conversation);
    if (automationExclusion) {
      throw new CommsHubError(409, 'conversation_automation_excluded', `Email account ${automationExclusion.accountKey} is outside Comms Hub automation.`, {
        failureClass: 'permanent',
        publicMessage: 'This conversation belongs to a mailbox that is intentionally outside AIMS automation.',
      });
    }
    if (operations?.owner_type === 'person') throw new CommsHubError(409, 'autonomous_reply_human_assigned', 'Autonomous replies are disabled while this conversation is assigned to Jonathan.');
    if (Number(draft.requires_approval) === 1) throw new CommsHubError(409, 'autonomous_reply_requires_approval', 'This draft requires human approval.');
    const state = ai?.state || ai || {};
    const latestRunSecurity = ai?.runs?.[0]?.metadata?.security || {};
    const latestResponseIntelligence = ai?.runs?.[0]?.metadata?.responseIntelligence || {};
    if (latestRunSecurity.promptInjectionDetected || latestRunSecurity.evidencePromptInjectionDetected) {
      throw new CommsHubError(409, 'autonomous_reply_security_blocked', 'Autonomous replies are blocked for conversations with prompt-injection or poisoned-context indicators.');
    }
    const safeClarification = latestResponseIntelligence.safeClarificationEligible === true;
    const safeDeterministicResponse = latestResponseIntelligence.safeDeterministicResponseEligible === true;
    const safeFormDelivery = latestResponseIntelligence.safeFormDeliveryEligible === true;
    const safeDeterministicDelivery = safeClarification || safeDeterministicResponse || safeFormDelivery;
    if (latestResponseIntelligence.version && latestResponseIntelligence.autonomousEligible !== true && !safeDeterministicDelivery) {
      throw new CommsHubError(409, 'autonomous_reply_response_intelligence_blocked', 'Smart Response Intelligence did not authorise autonomous delivery for this draft.');
    }
    const intent = state.intent || 'unknown';
    const policy = await this.context.operationsRepository.findAutonomousPolicy({ channel: conversation.channel, intent });
    if (!policy) throw new CommsHubError(409, 'autonomous_policy_not_found', 'No active autonomous reply policy matches this conversation.');
    const { risk, confidence } = resolveAutonomousAssessment(ai);
    const evidenceCount = Array.isArray(ai?.evidence) ? ai.evidence.length : Number(state.evidence_count || 0);
    const maximumRisk = Number(policy.maximum_risk);
    const minimumConfidence = Number(policy.minimum_confidence);
    const evidenceRequired = Number(policy.require_evidence) === 1;
    if (risk > maximumRisk || (!safeDeterministicDelivery && confidence < minimumConfidence) || (!safeDeterministicDelivery && evidenceRequired && evidenceCount < 1)) {
      throw new CommsHubError(
        409,
        'autonomous_reply_policy_rejected',
        `Draft does not meet autonomous policy ${policy.policy_key}: risk=${risk.toFixed(3)}/${maximumRisk.toFixed(3)}, confidence=${confidence.toFixed(
          3)}/${minimumConfidence.toFixed(3)}, evidence=${evidenceCount}${evidenceRequired ? ' required' : ' optional'}, safeDeterministicDelivery=${safeDeterministicDelivery}.`,
      );
    }
    const sentSince = await this.context.operationsRepository.countAutonomousSendsSince(policy.policy_key, new Date(Date.now() - 3_600_000).toISOString());
    if (sentSince >= Number(policy.maximum_per_hour)) throw new CommsHubError(429, 'autonomous_reply_rate_limited', 'Autonomous reply hourly limit has been reached.');
    const result = await sendReplyDraft({ draftId, context: this.context });
    await this.context.auditService.record({ actor: identity.actor, role: identity.role, action: 'autonomous_reply_sent', objectType: 'reply_draft', objectId: draftId,
       conversationId, details: { policyKey: policy.policy_key, channel: conversation.channel, risk, confidence, evidenceCount, responseReasons:
          latestResponseIntelligence.reasons || [], answerability: latestResponseIntelligence.answerability || null, model: ai?.runs?.[0]?.model || ai?.runs?.[0]?.model_name ||
             null, safeClarification, safeDeterministicResponse, safeFormDelivery, automated: true } });
    return { policy: policy.policy_key, ...result };
  }

  async upsertRetentionPolicy(input, identity) {
    const key = cleanKey(input.key);
    const retainDays = Number(input.retainDays);
    if (!key || !Number.isInteger(retainDays) || retainDays < 1) throw new CommsHubError(400, 'retention_policy_invalid', 'Retention key and retainDays are required.');
    const action = String(input.action || 'archive');
    if (!['archive', 'anonymise', 'delete'].includes(action)) throw new CommsHubError(400, 'retention_action_invalid', 'Retention action is invalid.');
    const createdAt = new Date().toISOString();
    const policy = await this.context.operationsRepository.upsertRetentionPolicy({ id: stableId('ret', key), key, channel: String(input.channel || 'any'), retainDays, action,
       legalHoldTag: input.legalHoldTag || null, active: input.active !== false, actor: identity.actor, createdAt });
    await this.context.auditService.record({ actor: identity.actor, role: identity.role, action: 'retention_policy_upserted', objectType: 'retention_policy', objectId: policy.id, after: policy });
    return policy;
  }

  async exportConversation({ conversationId, actor }) {
    const data = await this.context.operationsService.workspace(conversationId, { commsIdentity: { actor, role: 'admin' } });
    const createdAt = new Date().toISOString();
    const key = `exports/${createdAt.slice(0, 10)}/${conversationId}-${createdAt.replace(/[:.]/g, '-')}.json`;
    const stored = await this.context.privateR2.putText(key, JSON.stringify(data, null, 2), 'application/json', { conversation_id: conversationId, export_type: 'subject_access' });
    const job = await this.context.operationsRepository.createRetentionJob({ id: stableId('rtj', 'export', conversationId, createdAt), conversationId, contactId:
       data.conversation.contact_id, action: 'export', actor, requestedAt: createdAt, metadata: { sha256: stored.sha256 } });
    await this.context.operationsRepository.updateRetentionJob({ id: job.id, status: 'complete', exportObjectKey: key, completedAt: createdAt });
    await this.context.auditService.record({ actor, role: 'admin', action: 'conversation_exported', objectType: 'conversation', objectId: conversationId, conversationId,
       details: { objectKey: key, sha256: stored.sha256 } });
    return { jobId: job.id, objectKey: key, sha256: stored.sha256 };
  }

  async anonymise({ conversationId, actor }) {
    const conversation = await this.context.repository.getConversation(conversationId);
    if (!conversation) throw new CommsHubError(404, 'conversation_not_found', 'Conversation was not found.');
    const result = await this.context.operationsRepository.anonymiseConversation({ conversationId, contactId: conversation.contact_id });
    await this.context.auditService.record({ actor, role: 'admin', action: 'conversation_anonymised', objectType: 'conversation', objectId: conversationId, conversationId,
       details: { contactId: conversation.contact_id } });
    return result;
  }

  async deleteConversation({ conversationId, actor }) {
    const conversation = await this.context.repository.getConversation(conversationId);
    if (!conversation) throw new CommsHubError(404, 'conversation_not_found', 'Conversation was not found.');
    const objects = await this.context.operationsRepository.listAttachmentObjectsForConversation(conversationId);
    if (objects.length && !this.context.privateR2) throw new CommsHubError(503, 'retention_storage_unconfigured', 'Private object storage is required to delete attachment content safely.');
    for (const object of objects) await this.context.privateR2.delete(object.object_key);
    const result = await this.context.operationsRepository.hardDeleteConversation({ conversationId });
    if (!result.deleted) throw new CommsHubError(404, 'conversation_not_found', 'Conversation was not found.');
    await this.context.auditService.record({
      actor,
      role: 'admin',
      action: 'conversation_deleted',
      objectType: 'conversation',
      objectId: conversationId,
      details: { contactId: conversation.contact_id, deletedAttachmentObjects: objects.length, hardDeletion: true },
    });
    return { ...result, deletedAttachmentObjects: objects.length, hardDeletion: true };
  }
}
export default CommsHubGovernanceService;
