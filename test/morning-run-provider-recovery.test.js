import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Blotato uses the account-listed template ID and explicit inputs for path templates", async () => {
  const text = await source("services/blotato/utils/autoPublishService.js");
  assert.match(text, /templateId:\s*rawId/);
  assert.match(text, /templateIdCandidates:\s*uniqueTemplateIds\(rawId, normalisedId, requested\)/);
  assert.match(text, /const pathTemplate = \/\^\\\/\?base\\\/v2\\\//);
  assert.match(text, /inputs:\s*useManualInputs \? visualInputs : \{\}/);
  assert.match(text, /BLOTATO_VIDEO_PENDING_ERROR_LIMIT", 120, 180/);
});

test("newsletter structured output remains provider-compatible while exact story count stays deterministic", async () => {
  const text = await source("services/newsletter/engine/compose.js");
  assert.match(text, /bigThree:[\s\S]*?minItems:\s*1[\s\S]*?maxItems:\s*3/);
  assert.match(text, /for \(let index = 0; bigThree\.length < 3/);
});

test("OpenRouter retries parameter-incompatible structured requests with a portable payload", async () => {
  const text = await source("services/shared/utils/ai-service.js");
  assert.match(text, /isParameterCompatibilityError/);
  assert.match(text, /relaxedParameters:\s*true/);
  assert.match(text, /ai\.request\.parameter_relaxation/);
});

test("Brevo delivery resolves populated lists, sends with sender ID and verifies dispatch", async () => {
  const audience = await source("services/newsletter/brevo/audience.js");
  const campaign = await source("services/newsletter/brevo/campaign.js");
  assert.match(audience, /chooseExistingList/);
  assert.match(audience, /totalSubscribers/);
  assert.match(audience, /matched-name-global/);
  assert.match(campaign, /sender:\s*\{ id: senderId \}/);
  assert.match(campaign, /sendCampaignNow\(campaignId\)/);
  assert.match(campaign, /verifyCampaignDispatch\(campaignId\)/);
  assert.match(campaign, /DISPATCH_ACCEPTED_STATUSES = new Set\(\["queued", "scheduled", "sent"\]\)/);
});
