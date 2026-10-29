import test from 'node:test';
import assert from 'node:assert/strict';
import { checkWeekendMaintenance, MAINTENANCE_REPOSITORIES } from '../services/newsletter/engine/weekendMaintenance.js';

test('send-time clearance checks all eight repositories and detects delayed CI, council and scans', async () => {
  const seen = [];
  const result = await checkWeekendMaintenance({ fetcher: async url => {
    seen.push(url);
    return { ok: true, json: async () => ({ total_count: 1, workflow_runs: [{ path: '.github/workflows/council.yml', name: 'Council', id: 4 }] }) };
  } });
  assert.equal(seen.length, MAINTENANCE_REPOSITORIES.length);
  assert.equal(result.ok, true); assert.equal(result.busy, true);
});

test('unavailable or incomplete maintenance evidence cannot clear a send', async () => {
  const unavailable = await checkWeekendMaintenance({ fetcher: async () => ({ ok: false, status: 503 }) });
  assert.equal(unavailable.ok, false);
  const incomplete = await checkWeekendMaintenance({ fetcher: async () => ({ ok: true, json: async () => ({ total_count: 101, workflow_runs: [] }) }) });
  assert.equal(incomplete.ok, false);
  const clear = await checkWeekendMaintenance({ fetcher: async () => ({ ok: true, json: async () => ({ total_count: 0, workflow_runs: [] }) }) });
  assert.equal(clear.ok, true); assert.equal(clear.busy, false);
});
