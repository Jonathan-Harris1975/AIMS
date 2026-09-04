import { CommsHubError } from './errors.js';
import { stableId } from './domain/ids.js';

export class CommsHubQuarantineService {
  constructor({ context }) { this.context = context; this.handlers = new Map(); }
  register(sourceType, handler) { this.handlers.set(sourceType, handler); }
  async quarantine({ sourceType, sourceId, conversationId = null, failureClass = 'recoverable', payloadReference = null, errorCode = null, errorMessage = '', attempts = 0,
     metadata = {} }) { const createdAt = new Date().toISOString(); return this.context.operationsRepository.upsertQuarantineItem({ id: stableId('qua', sourceType, sourceId),
        sourceType, sourceId, conversationId, failureClass, payloadReference, errorCode, errorMessage, attempts, idempotencyKey: `quarantine:${sourceType}:${sourceId}`, createdAt, metadata }); }
  list(filters) { return this.context.operationsRepository.listQuarantine(filters); }
  async replay(id, identity) { const { item, attemptId } = await this.context.operationsRepository.beginQuarantineReplay({ id, actor: identity.actor }); const handler =
     this.handlers.get(item.source_type); if (!handler) { await this.context.operationsRepository.finishQuarantineReplay({ id, attemptId, outcome: 'blocked', detail:
        `No replay handler for ${item.source_type}.` }); throw new CommsHubError(409, 'quarantine_replay_unsupported', 'This quarantined item has no safe replay handler.');
           } try { const result = await handler(item); await this.context.operationsRepository.finishQuarantineReplay({ id, attemptId, outcome: 'success', detail:
              'Replay completed.' }); await this.context.auditService.record({ actor: identity.actor, role: identity.role, action: 'quarantine_replayed', objectType:
                 'quarantine', objectId: id, conversationId: item.conversation_id, details: { sourceType: item.source_type } }); return result; } catch (error) {
                    await this.context.operationsRepository.finishQuarantineReplay({ id, attemptId, outcome: 'failed', detail: error.message }); throw error; } }
}
export default CommsHubQuarantineService;
