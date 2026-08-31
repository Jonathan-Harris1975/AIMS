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
  assert.match(text, /templateIdCandidates:\s*uniqueTemplateIds\(rawId, uuidFallback, requested\)/);
  assert.match(text, /templateIdCandidates:\s*uniqueTemplateIds\(resolvedId, uuidFallback, requested, DEFAULT_AI_STORY_TEMPLATE_PATH\)/);
  assert.match(text, /buildVisualCreationRequest/);
  assert.match(request, /inputs:\s*manualInputsConfigured \? visualInputs : \{\}/);
  assert.match(request, /prompt,/);
  assert.doesNotMatch(text, /manualInputsConfigured \|\| pathTemplate/);
  assert.match(text, /BLOTATO_VIDEO_PENDING_ERROR_LIMIT", 120, 180/);
});

test("Blotato scheduled slots are idempotent after a paid visual has been created", async () => {
  const text = await source("services/blotato/utils/autoPublishService.js");
  const routes = await source("services/blotato/routes/index.js");
  assert.match(text, /findExistingScheduledSlotJob/);
  assert.match(text, /jobOwnsScheduledSlot/);
  assert.match(text, /job\.videoId \|\| job\.mediaUrl \|\| job\.result\?\.visualId \|\| job\.result\?\.mediaUrl/);
  assert.match(text, /blotato\.schedule\.duplicate_prevented/);
  assert.match(routes, /requestDedupe\("blotato:autoshorts:schedule"\)/);
  assert.match(routes, /requestDedupe\("blotato:lane:schedule"\)/);
});

test("newsletter structured output remains provider-compatible while exact story count stays deterministic", async () => {
  const text = await source("services/newsletter/engine/compose.js");
  assert.match(text, /bigThree:\s*\{[\s\S]*?type:\s*"array"[\s\S]*?items:\s*\{/);
  assert.doesNotMatch(text, /\bminItems\s*:/);
  assert.doesNotMatch(text, /\bmaxItems\s*:/);
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

test("Blotato scheduled runs use deterministic slot sessions and a hard two-render daily fuse", async () => {
  const text = await source("services/blotato/utils/autoPublishService.js");
  const defaults = await source("config/production.defaults.env");
  assert.match(text, /createScheduledSessionId/);
  assert.match(text, /`BLT-\$\{lane\}-\$\{scheduleDate\}-\$\{slot\}`/);
  assert.match(text, /BLOTATO_DAILY_PAID_RENDER_CAP", 2, 10/);
  assert.match(text, /blotato-daily-paid-render-cap/);
  assert.match(text, /paidVisualIdsForDate\(scheduleDate\)/);
  assert.match(text, /inferScheduleSlotFromJob\(job\) === scheduleSlot/);
  assert.match(text, /scheduleDateFromJob\(job\) === scheduleDate/);
  assert.match(
    text,
    /reusableRenderedVideo\(lane\.jobType, articleSource\.article, sessionId, \{\s*scheduleSlot,\s*scheduleDate: activeScheduleDate,\s*briefFingerprint,\s*\}\)/
  );
  assert.match(defaults, /^BLOTATO_DAILY_PAID_RENDER_CAP=2$/m);
});
