import test from 'node:test';
import assert from 'node:assert/strict';
import { workerRunAdvanced } from '../services/comms-hub/workerHeartbeatState.js';

test('completed worker runs advance success heartbeat', () => {
  assert.equal(workerRunAdvanced({ processed: 0, results: [] }), true);
  assert.equal(workerRunAdvanced({ processed: 2 }), true);
});

test('skipped runs never advance success heartbeat', () => {
  for (const reason of ['already_running', 'stopping', 'outside_business_hours', 'not_due', 'disabled', 'lease_held', 'uidvalidity_rebaseline']) {
    assert.equal(workerRunAdvanced({ skipped: true, reason }), false, reason);
  }
  assert.equal(workerRunAdvanced({ skipped: true }), false);
});
