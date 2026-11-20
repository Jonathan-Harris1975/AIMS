import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('royalty-floor API retries reach its durable ledger rather than generic request dedupe HTTP 202', () => {
  const source = readFileSync(new URL('../services/kdp/operations.js', import.meta.url), 'utf8');
  assert.match(source, /router\.post\("\/audit\/pricing\/royalty-floor\/run", asyncRoute\(/);
  assert.doesNotMatch(source, /router\.post\("\/audit\/pricing\/royalty-floor\/run", requestDedupe\(/);
  assert.match(source, /startJob\(req, res, "audit-royalty-floor"/);
});

test('print production is also polled by a real async session on recovery retries', () => {
  const source = readFileSync(new URL('../services/kdp/operations.js', import.meta.url), 'utf8');
  assert.match(source, /router\.post\("\/print\/production\/run", asyncRoute\(/);
  assert.doesNotMatch(source, /router\.post\("\/print\/production\/run", requestDedupe\(/);
  assert.match(source, /startJob\(req, res, "print-production"/);
});
