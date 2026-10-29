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

test('a website-scoped token falls back to public read-only evidence for the other repositories', async () => {
  let fallbackReads = 0;
  const result = await checkWeekendMaintenance({ token: 'scoped-test-token', fetcher: async (_url, options) => {
    if (options.headers.Authorization) return { ok: false, status: 403 };
    fallbackReads += 1;
    return { ok: true, json: async () => ({ total_count: 0, workflow_runs: [] }) };
  } });
  assert.equal(result.ok, true); assert.equal(result.busy, false);
  assert.equal(fallbackReads, 8);
});
