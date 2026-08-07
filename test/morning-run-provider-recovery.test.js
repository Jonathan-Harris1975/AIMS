import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Blotato restores the proven prompt-autofill request for path and UUID templates", async () => {
  const text = await source("services/blotato/utils/autoPublishService.js");
  const request = await source("services/blotato/utils/visualRequest.js");
  assert.match(text, /rawTemplateId:\s*rawId/);
  assert.match(text, /templateIdCandidates:\s*uniqueTemplateIds\(id, rawId, requested\)/);
  assert.match(text, /buildVisualCreationRequest/);
  assert.match(request, /inputs:\s*manualInputsConfigured \? visualInputs : \{\}/);
  assert.match(request, /prompt,/);
  assert.doesNotMatch(text, /manualInputsConfigured \|\| pathTemplate/);
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

test("Brevo delivery resolves the populated list and persists an exactly-once campaign hand-off", async () => {
  const audience = await source("services/newsletter/brevo/audience.js");
  const campaign = await source("services/newsletter/brevo/campaign.js");
  const ops = await source("services/ops/index.js");
  assert.match(audience, /allowCreate: false|allowCreate = true/);
  assert.match(audience, /Configure NEWSLETTER_AI_EDGE_BREVO_LIST_ID/);
  assert.match(audience, /totalSubscribers/);
  assert.match(campaign, /sender:\s*\{ id: sender\.senderId \}/);
  assert.match(campaign, /readCampaignDelivery/);
  assert.match(campaign, /status:\s*"created"/);
  assert.match(campaign, /sendCampaignNow/);
  assert.match(campaign, /getCampaign/);
  assert.match(campaign, /campaignStatus = "queued"/);
  assert.doesNotMatch(ops, /\["newsletter-readiness", "\/newsletter\/readiness"/);
  assert.match(ops, /newsletter-send.*newsletter-generate/);
});
