import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { nthWeekdayGuard } from '../audits/utils/monthlyAuditWindow.js';

function allowed(date, occurrence, force = false) {
  const res = { status(code) { this.code = code; return this; }, json(value) { this.body = value; } };
  const result = nthWeekdayGuard({ body: { force } }, res,
    { weekday: 'Fri', occurrence, error: 'outside-window', hint: 'Monthly Friday' }, new Date(date));
  return { result, res };
}

test('November website and AIMS dates match the MAST first/second Friday contract', () => {
  assert.equal(allowed('2026-11-06T12:00:00Z', 1).result, true);
  assert.equal(allowed('2026-11-13T18:00:00Z', 2).result, true);
  for (const [date, occurrence] of [['2026-11-01T12:00:00Z', 1], ['2026-11-14T09:15:00Z', 2], ['2026-11-13T12:00:00Z', 1]]) {
    const { result, res } = allowed(date, occurrence);
    assert.equal(result, false);
    assert.equal(res.code, 409);
  }
});

test('BST calendar boundary uses London date and explicit recovery override is retained', () => {
  assert.equal(allowed('2027-06-03T23:30:00Z', 1).result, true);
  assert.equal(allowed('2027-06-04T23:30:00Z', 1).result, false);
  assert.equal(allowed('2026-11-08T12:00:00Z', 1, true).result, true);
});

test('both monthly routes enforce Friday at their intended occurrence', () => {
  const route = readFileSync(new URL('../audits/routes/monthly.js', import.meta.url), 'utf8');
  assert.match(route, /router.post\("\/website"[\s\S]*?weekday: "Fri",\s*occurrence: 1/);
  assert.match(route, /router.post\("\/aims"[\s\S]*?weekday: "Fri",\s*occurrence: 2/);
});
