import test from 'node:test';
import assert from 'node:assert/strict';
import editAndFormat, { __testing } from '../services/script/utils/editAndFormat.js';
import { BANNED_PROMO_PATTERNS, cleanLexiconText } from '../services/content-quality/brandLexicon.js';

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
  const input = 'This sentence keeps going because the original report flagged overlong podcast delivery, and it needs a cleaner spoken rhythm for Brian, while still \
preserving the basic meaning for listeners.';
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

test('final script pass removes every phrase rejected by the podcast promotional-language gate', () => {
  const input = [
    'Buy now during this limited time offer, and don’t miss out.',
    'The guaranteed secret formula promises to make money fast and get rich.',
    'Supporters call it a groundbreaking, revolutionary, cutting-edge and transformative paradigm shift.',
    'They say it will unlock the future, delve into the detail, and become a game changer.',
  ].join(' ');

  const output = editAndFormat(input);

  const validatorText = cleanLexiconText(output);
  for (const pattern of BANNED_PROMO_PATTERNS) {
    pattern.lastIndex = 0;
    assert.equal(pattern.test(validatorText), false, `Banned pattern survived final formatting: ${pattern}`);
  }
});

test('final script pass cleans council-style output without leaving overlong sentences', () => {
  const overlong = [
    'This sentence keeps adding unnecessary detail because the repair model was asked to sound natural but was not required',
    'to pass the exact deterministic twenty five word production threshold before returning its output to validation.',
  ].join(' ');
  const input = `${Array.from({ length: 20 }, () => overlong).join(' ')} This was described as transformative.`;
  const output = editAndFormat(input);
  const longest = output
    .split(/[.!?]+/)
    .map((sentence) => sentence.trim().split(/\s+/).filter(Boolean).length)
    .reduce((max, count) => Math.max(max, count), 0);

  assert.ok(longest <= 25, `Expected longest sentence <= 25 words, got ${longest}`);
  assert.doesNotMatch(output, /\btransformative\b/i);
});
