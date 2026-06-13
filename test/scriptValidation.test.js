import test from "node:test";
import assert from "node:assert/strict";

import {
  hasRequiredOutro,
  extractOutro,
  enforceCanonicalOutro,
  findBrokenPunctuationJoins,
  findLongSpokenSentences,
  splitSpokenSentences,
  validateTranscriptStructure,
} from "../services/script/utils/scriptValidation.js";
import { OUTRO_CLOSING_TAGLINE } from "../services/script/utils/promptTemplates.js";

const canonicalWithStraightQuotes = OUTRO_CLOSING_TAGLINE
  .replace(/[’]/g, "'")
  .replace(/[—]/g, "-");

const transcript = `Intro section that is comfortably long enough to get us over the minimum validation length without any drama whatsoever. It keeps going because machines are needy and validators are worse.

Main section that is also long enough to look like a real transcript. It explains what happened, why it matters, and avoids collapsing into marketing paste. There is enough content here to make the parser stop sulking.

The week was noisy, the claims were louder, and the useful part was buried under the usual varnish. For the daily brief, head to jonathan-harris dot online. If you want the longer version, take a look at the related book as well.

${canonicalWithStraightQuotes}`;

test("script validation accepts the required outro when quotes and dashes are normalised", () => {
  assert.equal(hasRequiredOutro(transcript), true);

  const outro = extractOutro(transcript);
  assert.match(outro, /The week was noisy/);
  assert.match(outro, /jonathan-harris dot online/);
  assert.match(outro, /That's your lot for this week's Turing's Torch\./);

  const validation = validateTranscriptStructure(transcript);
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.reasons, []);
});


test("enforceCanonicalOutro appends the canonical branded closing line when the model omits it", () => {
  const draftOutro = `The week was loud and the sensible part took a bit of digging. For the daily brief, head to jonathan-harris dot online. If you want the deeper version, this week's book will sort that out.`;

  const repaired = enforceCanonicalOutro(draftOutro);

  assert.equal(hasRequiredOutro(repaired), true);
  assert.match(repaired, /That’s your lot for this week’s Turing’s Torch\./);
  assert.equal(repaired.endsWith(OUTRO_CLOSING_TAGLINE), true);
});

import editAndFormat from "../services/script/utils/editAndFormat.js";

function makeTranscript(mainText) {
  const intro = `This intro is long enough to look like a real opening. It sets up a noisy week in artificial intelligence without pretending every vendor announcement is a thunderbolt from Mount Procurement. It gives the listener enough context to settle in and understand the stakes.`;

  const main = `The rest of the analysis keeps the episode comfortably above the validation floor. It talks about power, money, control, risk, regulation, incentives, infrastructure, and why ordinary listeners should care when polished demos become procurement decisions. ${mainText}`;

  const outroBody = `The week was noisy, the claims were louder, and the useful part was buried under the usual varnish. For the daily brief, head to jonathan-harris dot online. If you want the longer version, take a look at the related book as well.`;

  return `${intro}\n\n${main}\n\n${outroBody}\n\n${OUTRO_CLOSING_TAGLINE}`;
}

test("script validation rejects a dangling fragment immediately before the outro", () => {
  const badTranscript = makeTranscript(
    "They dictate how artificial intelligence is used, who has access, and how it evolves. Companies"
  );

  const validation = validateTranscriptStructure(badTranscript);

  assert.equal(validation.ok, false);
  assert.ok(
    validation.reasons.some((reason) => /dangling|before outro|unfinished/i.test(reason)),
    validation.reasons.join("; ")
  );
});

test("script validation does not mistake a.m. or p.m. for broken lowercase punctuation joins", () => {
  const joins = findBrokenPunctuationJoins("The service runs from 9 a.m. to 5 p.m. on weekdays.");
  assert.deepEqual(joins, []);
});

test("editAndFormat repairs the known lowercase punctuation glitch safely", () => {
  const formatted = editAndFormat("That choice should sit with our. consciences, not a procurement spreadsheet.");

  assert.doesNotMatch(formatted, /our\. consciences/);
  assert.match(formatted, /our consciences/);
});

test("editAndFormat keeps the branded outro closing line intact", () => {
  const formatted = editAndFormat(makeTranscript("The main section lands cleanly with no dangling fragment."));

  assert.equal(formatted.includes(OUTRO_CLOSING_TAGLINE), true);
});

test("editAndFormat does not speak long ebook URL paths", () => {
  const formatted = editAndFormat(
    "This week's book is at https://jonathan-harris.online/ebooks/artificial-intelligence-and-the-future-of-work."
  );

  assert.match(formatted, /jonathan-harris dot online, under eBooks/);
  assert.doesNotMatch(formatted, /slash|artificial-intelligence-and-the-future-of-work/);
});

test("editAndFormat normalises high-confidence British spelling", () => {
  const formatted = editAndFormat("There was clamor around the launch.");

  assert.match(formatted, /clamour/);
  assert.doesNotMatch(formatted, /clamor/);
});

test("editAndFormat splits a clearly overlong spoken sentence without tiny fragments", () => {
  const formatted = editAndFormat(
    "This sentence keeps adding clauses because the source copy was bloated, and it keeps stacking detail after detail until the spoken rhythm collapses under the weight of its own procurement-friendly fog, while another needless clause keeps marching forward with a clipboard."
  );

  const sentences = formatted.match(/[^.!?]+[.!?]+/g) || [];
  assert.ok(sentences.length > 1, formatted);
  for (const sentence of sentences) {
    const count = sentence.trim().split(/\s+/).length;
    assert.ok(count > 3, `fragment created: ${sentence}`);
    assert.ok(count <= 32, `sentence too long (${count} words): ${sentence}`);
  }
});

test("spoken sentence parsing respects punctuation followed by closing quotes", () => {
  const quoted = `It's enough to make one recall Alan Turing himself, who once observed, and I'm paraphrasing slightly for clarity, that "The original question, 'Can machines think?' I believe to be too meaningless to deserve discussion." It's a sentiment that seems particularly pertinent when sifting through the sheer volume of what's being presented to us each week.`;

  const sentences = splitSpokenSentences(quoted);
  assert.equal(sentences.length, 3, sentences.join(" | "));
  assert.deepEqual(findLongSpokenSentences(quoted, { maxWords: 25 }), []);
});

test("spoken sentence validation still catches a genuinely overlong sentence", () => {
  const genuinelyLong = "This deliberately long sentence keeps adding one clause after another while avoiding all useful punctuation so the validator can prove that genuine spoken-word bloat still triggers the hard quality control instead of slipping through unnoticed during production.";

  const defects = findLongSpokenSentences(genuinelyLong, { maxWords: 25 });
  assert.equal(defects.length, 1);
  assert.ok(defects[0].wordCount > 25);
});
