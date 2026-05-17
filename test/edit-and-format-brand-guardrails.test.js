import test from 'node:test';
import assert from 'node:assert/strict';
import editAndFormat, { __testing } from '../services/script/utils/editAndFormat.js';

test('final script pass applies British spelling and anti-hype replacements', () => {
  const input = 'We delve into the groundbreaking AI landscape and optimize personalized behavior analysis.';
  const output = editAndFormat(input);

  assert.match(output, /examine/i);
  assert.match(output, /notable/i);
  assert.match(output, /field/i);
  assert.match(output, /optimise/i);
  assert.match(output, /personalised/i);
  assert.match(output, /behaviour/i);
  assert.match(output, /artificial intelligence/i);
  assert.doesNotMatch(output, /\bAI\b/);
  assert.doesNotMatch(output, /\bdelve into\b/i);
  assert.doesNotMatch(output, /\bgroundbreaking\b/i);
  assert.doesNotMatch(output, /\blandscape\b/i);
});

test('final script pass splits long spoken sentences below the podcast QA threshold', () => {
  const input = 'This sentence keeps going because the original report flagged overlong podcast delivery, and it needs a cleaner spoken rhythm for Brian, while still preserving the basic meaning for listeners.';
  const output = editAndFormat(input);
  const longest = output
    .split(/[.!?]+/)
    .map((sentence) => sentence.trim().split(/\s+/).filter(Boolean).length)
    .reduce((max, count) => Math.max(max, count), 0);

  assert.ok(longest <= 26, `Expected longest sentence <= 26 words, got ${longest}: ${output}`);
});

test('anti-hype helper preserves sentence case', () => {
  assert.equal(__testing.normaliseAntiHypePhrases('Groundbreaking results.'), 'Notable results.');
});
