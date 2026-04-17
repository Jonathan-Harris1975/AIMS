import test from "node:test";
import assert from "node:assert/strict";

import {
  hasRequiredOutro,
  extractOutro,
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
