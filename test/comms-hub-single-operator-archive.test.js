import test from 'node:test';
import assert from 'node:assert/strict';

import { CommsHubOperationsService } from '../services/comms-hub/operationsService.js';
import { CommsHubMonthEndConversationArchiveWorker, currentMonthArchiveCutoff } from '../services/comms-hub/workers/monthEndConversationArchiveWorker.js';
import { runInboundConversationAutomation } from '../services/comms-hub/inboundAutomationService.js';

test('manual archive is allowed only after a conversation is resolved', async () => {
  let updateCalled = false;
  const service = new CommsHubOperationsService({ context: {
    operationsRepository: {
      async getConversationOperations() { return { operational_status: 'open', version: 2 }; },
      async updateConversationStatus() { updateCalled = true; return {}; },
    },
    aiRepository: { async cancelFollowUpsForConversation() {} },
    auditService: { async record() {} },
  } });

  await assert.rejects(
    service.updateStatus({ conversationId: 'cnv_test', status: 'archived' }, { commsIdentity: { actor: 'Jonathan', role: 'admin' } }),
    (error) => error?.code === 'conversation_archive_requires_resolution',
  );
  assert.equal(updateCalled, false);
});

test('month-end archive selects only resolved conversations before the current local month', async () => {
  const calls = [];
  const context = {
    config: {
      monthEndArchiveEnabled: true,
      monthEndArchivePollMs: 21_600_000,
      monthEndArchiveBatchSize: 100,
      businessTimeZone: 'Europe/London',
    },
    operationsRepository: {
      async listResolvedBeforeArchiveCutoff(cutoff, limit) {
        calls.push(['list', cutoff, limit]);
        return [{ conversation_id: 'cnv_old', version: 4 }];
      },
    },
    operationsService: {
      async updateStatus(input) { calls.push(['archive', input]); return { operational_status: 'archived' }; },
    },
  };
  const worker = new CommsHubMonthEndConversationArchiveWorker({ context });
  const result = await worker.runOnce({ now: '2026-08-17T12:00:00.000Z' });

  assert.equal(result.archived, 1);
  assert.equal(calls[0][1], '2026-07-31T23:00:00.000Z');
  assert.equal(calls[1][1].status, 'archived');
  assert.equal(calls[1][1].reason, 'automatic_month_end_archive');
});

test('UK month cutoff handles winter GMT as well as summer BST', () => {
  assert.equal(currentMonthArchiveCutoff(new Date('2026-01-17T12:00:00Z'), 'Europe/London'), '2026-01-01T00:00:00.000Z');
  assert.equal(currentMonthArchiveCutoff(new Date('2026-08-17T12:00:00Z'), 'Europe/London'), '2026-07-31T23:00:00.000Z');
});

test('single-operator assignment prevents inbound autonomous analysis and send', async () => {
  let analysed = false;
  let sent = false;
  const context = {
    config: { aiEnabled: true, autonomousRepliesEnabled: true },
    operationsRepository: { async getConversationOperations() { return { owner_type: 'person', owner_id: 'Jonathan' }; } },
    aiWorkflowService: { async analyseConversation() { analysed = true; return { draft: { id: 'draft', requiresApproval: false } }; } },
    governanceService: { async attemptAutonomousReply() { sent = true; } },
  };
  const result = await runInboundConversationAutomation({ context, conversationId: 'cnv_assigned' });
  assert.equal(result.reason, 'human_assigned');
  assert.equal(analysed, false);
  assert.equal(sent, false);
});
