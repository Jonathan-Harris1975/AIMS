import { CommsHubError } from './errors.js';
import { stableId } from './domain/ids.js';
import { sendReplyDraft } from './replyDraftService.js';

function cleanKey(value) { return String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '_').slice(0, 80); }

export class CommsHubGovernanceService {
  constructor({ context }) { this.context = context; }

  async upsertAutonomousPolicy(input, identity) {
    const key = cleanKey(input.key);
    if (!key) throw new CommsHubError(400, 'autonomous_policy_key_invalid', 'Autonomous policy key is required.');
    const status = String(input.status || 'draft').toLowerCase();
    if (!['draft', 'active', 'disabled'].includes(status)) throw new CommsHubError(400, 'autonomous_policy_status_invalid', 'Autonomous policy status is invalid.');
    if (status === 'active' && identity.role !== 'admin' && identity.role !== 'reviewer') throw new CommsHubError(403, 'autonomous_policy_approval_denied', 'Only a reviewer or administrator may activate autonomous replies.');
    const createdAt = new Date().toISOString();
    const policy = await this.context.operationsRepository.upsertAutonomousPolicy({ id: stableId('arp', key), key, channel: String(input.channel || 'any'), intent: String(input.intent || 'any'), maximumRisk: Number(input.maximumRisk ?? 0.15), minimumConfidence: Number(input.minimumConfidence ?? 0.9), requireEvidence: input.requireEvidence !== false, allowedHours: input.allowedHours || {}, maximumPerHour: Math.min(Math.max(Number(input.maximumPerHour) || 1, 1), 50), status, actor: identity.actor, approvedBy: status === 'active' ? identity.actor : null, createdAt });
    await this.context.auditService.record({ actor: identity.actor, role: identity.role, action: 'autonomous_policy_upserted', objectType: 'autonomous_policy', objectId: policy.id, after: policy });
    return policy;
  }

  async attemptAutonomousReply({ conversationId, draftId }, identity = { actor: 'autonomous-worker', role: 'admin' }) {
    if (!this.context.config.autonomousRepliesEnabled) throw new CommsHubError(409, 'autonomous_replies_disabled', 'Autonomous replies are disabled.');
    const [conversation, ai, draft] = await Promise.all([this.context.repository.getConversation(conversationId), this.context.aiRepository.getConversationAiState(conversationId), this.context.aiRepository.getDraft(draftId)]);
    if (!conversation || !draft || draft.conversation_id !== conversationId) throw new CommsHubError(404, 'autonomous_reply_target_missing', 'Conversation or reply draft was not found.');
    if (Number(draft.requires_approval) === 1) throw new CommsHubError(409, 'autonomous_reply_requires_approval', 'This draft requires human approval.');
    const state = ai?.state || ai || {};
    const intent = state.intent || 'unknown';
    const policy = await this.context.operationsRepository.findAutonomousPolicy({ channel: conversation.channel, intent });
    if (!policy) throw new CommsHubError(409, 'autonomous_policy_not_found', 'No active autonomous reply policy matches this conversation.');
    const risk = Number(state.risk_score ?? 1);
    const confidence = Number(state.confidence ?? 0);
    const evidenceCount = Array.isArray(ai?.evidence) ? ai.evidence.length : Number(state.evidence_count || 0);
    if (risk > Number(policy.maximum_risk) || confidence < Number(policy.minimum_confidence) || (Number(policy.require_evidence) === 1 && evidenceCount < 1)) throw new CommsHubError(409, 'autonomous_reply_policy_rejected', 'Draft does not meet the active autonomous reply policy.');
    const sentSince = await this.context.operationsRepository.countAutonomousSendsSince(policy.policy_key, new Date(Date.now() - 3_600_000).toISOString());
    if (sentSince >= Number(policy.maximum_per_hour)) throw new CommsHubError(429, 'autonomous_reply_rate_limited', 'Autonomous reply hourly limit has been reached.');
    const result = await sendReplyDraft({ draftId, context: this.context });
    await this.context.auditService.record({ actor: identity.actor, role: identity.role, action: 'autonomous_reply_sent', objectType: 'reply_draft', objectId: draftId, conversationId, details: { policyKey: policy.policy_key, risk, confidence, evidenceCount, automated: true } });
    return { policy: policy.policy_key, ...result };
  }

  async upsertRetentionPolicy(input, identity) {
    const key = cleanKey(input.key);
    const retainDays = Number(input.retainDays);
    if (!key || !Number.isInteger(retainDays) || retainDays < 1) throw new CommsHubError(400, 'retention_policy_invalid', 'Retention key and retainDays are required.');
    const action = String(input.action || 'archive');
    if (!['archive', 'anonymise', 'delete'].includes(action)) throw new CommsHubError(400, 'retention_action_invalid', 'Retention action is invalid.');
    const createdAt = new Date().toISOString();
    const policy = await this.context.operationsRepository.upsertRetentionPolicy({ id: stableId('ret', key), key, channel: String(input.channel || 'any'), retainDays, action, legalHoldTag: input.legalHoldTag || null, active: input.active !== false, actor: identity.actor, createdAt });
    await this.context.auditService.record({ actor: identity.actor, role: identity.role, action: 'retention_policy_upserted', objectType: 'retention_policy', objectId: policy.id, after: policy });
    return policy;
  }

  async exportConversation({ conversationId, actor }) {
    const data = await this.context.operationsService.workspace(conversationId, { commsIdentity: { actor, role: 'admin' } });
    const createdAt = new Date().toISOString();
    const key = `exports/${createdAt.slice(0, 10)}/${conversationId}-${createdAt.replace(/[:.]/g, '-')}.json`;
    const stored = await this.context.privateR2.putText(key, JSON.stringify(data, null, 2), 'application/json', { conversation_id: conversationId, export_type: 'subject_access' });
    const job = await this.context.operationsRepository.createRetentionJob({ id: stableId('rtj', 'export', conversationId, createdAt), conversationId, contactId: data.conversation.contact_id, action: 'export', actor, requestedAt: createdAt, metadata: { sha256: stored.sha256 } });
    await this.context.operationsRepository.updateRetentionJob({ id: job.id, status: 'complete', exportObjectKey: key, completedAt: createdAt });
    await this.context.auditService.record({ actor, role: 'admin', action: 'conversation_exported', objectType: 'conversation', objectId: conversationId, conversationId, details: { objectKey: key, sha256: stored.sha256 } });
    return { jobId: job.id, objectKey: key, sha256: stored.sha256 };
  }

  async anonymise({ conversationId, actor }) {
    const conversation = await this.context.repository.getConversation(conversationId);
    if (!conversation) throw new CommsHubError(404, 'conversation_not_found', 'Conversation was not found.');
    const result = await this.context.operationsRepository.anonymiseConversation({ conversationId, contactId: conversation.contact_id });
    await this.context.auditService.record({ actor, role: 'admin', action: 'conversation_anonymised', objectType: 'conversation', objectId: conversationId, conversationId, details: { contactId: conversation.contact_id } });
    return result;
  }

  async deleteConversation({ conversationId, actor }) {
    const conversation = await this.context.repository.getConversation(conversationId);
    if (!conversation) throw new CommsHubError(404, 'conversation_not_found', 'Conversation was not found.');
    const objects = await this.context.operationsRepository.listAttachmentObjectsForConversation(conversationId);
    if (objects.length && !this.context.privateR2) throw new CommsHubError(503, 'retention_storage_unconfigured', 'Private object storage is required to delete attachment content safely.');
    for (const object of objects) await this.context.privateR2.delete(object.object_key);
    const result = await this.context.operationsRepository.deleteConversationContent({ conversationId, contactId: conversation.contact_id });
    await this.context.auditService.record({
      actor,
      role: 'admin',
      action: 'conversation_deleted',
      objectType: 'conversation',
      objectId: conversationId,
      conversationId,
      details: { contactId: conversation.contact_id, deletedAttachmentObjects: objects.length, logicalDeletion: true },
    });
    return { ...result, deletedAttachmentObjects: objects.length, logicalDeletion: true };
  }
}
export default CommsHubGovernanceService;
