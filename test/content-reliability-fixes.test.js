import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildArtworkVisualQaPrompt,
  normaliseArtworkVisualQa,
} from "../services/artwork/utils/artworkVisualQa.js";
import { zonedDateTimeString, zonedDateTimeToUtcDate } from "../services/zernio/utils/date.js";
import { createDeterministicAiFallbackPng } from "../services/artwork/utils/deterministicAiFallback.js";

test("newsletter artwork QA rejects travel drift and pseudo-text", () => {
  const prompt = buildArtworkVisualQaPrompt({ mode: "newsletter", creativePrompt: "AI security story" });
  assert.match(prompt, /not anime, fantasy illustration, travel, tourism, lifestyle/i);
  assert.match(prompt, /pseudo-readable typography is a hard failure/i);

  const result = normaliseArtworkVisualQa({
    score: 82,
    relevance: 30,
    textSafety: 40,
    composition: 80,
    brandFit: 35,
    defects: ["Looks like travel advertising"],
    hardDefects: ["Pseudo-text in banner"],
    summary: "Wrong visual category",
  });
  assert.equal(result.pass, false);
});

test("newsletter delivery uses an existing populated Brevo list and exposes readiness", async () => {
  const audience = await readFile(new URL("../services/newsletter/brevo/audience.js", import.meta.url), "utf8");
  const campaign = await readFile(new URL("../services/newsletter/brevo/campaign.js", import.meta.url), "utf8");
  const routes = await readFile(new URL("../services/newsletter/routes/send.js", import.meta.url), "utf8");
  const env = await readFile(new URL("../config/production.defaults.env", import.meta.url), "utf8");
  assert.match(audience, /audience_not_configured/);
  assert.match(campaign, /audience_empty/);
  assert.match(campaign, /getNewsletterDeliveryReadiness/);
  assert.match(routes, /router\.post\("\/readiness"/);
  assert.match(env, /^NEWSLETTER_BREVO_ALLOW_LIST_CREATE=false$/m);
});

test("newsletter structured output avoids provider-incompatible array cardinality and disables reasoning", async () => {
  const compose = await readFile(new URL("../services/newsletter/engine/compose.js", import.meta.url), "utf8");
  const council = await readFile(new URL("../services/newsletter/engine/editorialCouncil.js", import.meta.url), "utf8");
  assert.doesNotMatch(compose, /maxItems:\s*[35]/);
  assert.doesNotMatch(compose, /minItems:\s*1/);
  assert.match(compose, /reasoning: \{ effort: "none", exclude: true \}/);
  assert.match(council, /reasoning: \{ effort: "none", exclude: true \}/);
});

test("newsletter review routes avoid the logged unsupported GPT targets", async () => {
  const config = await readFile(new URL("../ai-config.js", import.meta.url), "utf8");
  assert.match(config, /newsletterFactCheck: routeChain\(\["audit", "highQuality"\]/);
  assert.match(config, /newsletterAudienceReview: routeChain\(\["highQuality", "audit"\]/);
  assert.match(config, /newsletterCouncilChair: routeChain\(\["audit", "highQuality"\]/);
});

test("Saturday semantic repair and social artwork rules are present", async () => {
  const scheduler = await readFile(new URL("../services/zernio/utils/socialScheduler.js", import.meta.url), "utf8");
  assert.match(scheduler, /buildZernioSemanticRepairPrompt/);
  assert.match(scheduler, /strongest credible case on both sides/i);
  assert.match(scheduler, /not an infographic, dashboard, diagram/i);
  assert.match(scheduler, /generic racks of servers/i);
});

test("empty OpenRouter completions fail over after a bounded provider budget", async () => {
  const ai = await readFile(new URL("../services/shared/utils/ai-service.js", import.meta.url), "utf8");
  const env = await readFile(new URL("../config/production.defaults.env", import.meta.url), "utf8");
  assert.match(ai, /empty_completion_budget_exhausted/);
  assert.match(env, /^AI_EMPTY_COMPLETION_RETRIES_PER_PROVIDER=1$/m);
});


test("social blog and mini-series have source-specific topicality gates", async () => {
  const socialPackage = await readFile(new URL("../services/blog/utils/socialBlogPackage.js", import.meta.url), "utf8");
  const scheduler = await readFile(new URL("../services/zernio/utils/socialScheduler.js", import.meta.url), "utf8");
  const aiConfig = await readFile(new URL("../ai-config.js", import.meta.url), "utf8");
  assert.match(socialPackage, /source_urls/);
  assert.match(socialPackage, /analyseTopicFidelity/);
  assert.match(scheduler, /miniSeriesThemeDefects/);
  assert.match(scheduler, /Mini-series part .* no approved source URL/);
  assert.match(aiConfig, /zernioMiniSeriesResearch/);
  assert.match(aiConfig, /blogSocial: routeChain\(\["highQuality", "audit"/);
});

test("Blotato finished duration and visual QA are applied before publishing", async () => {
  const publish = await readFile(new URL("../services/blotato/utils/autoPublishService.js", import.meta.url), "utf8");
  const renderedQa = await readFile(new URL("../services/blotato/utils/renderedVideoQa.js", import.meta.url), "utf8");
  assert.match(publish, /reviewRenderedVideo/);
  assert.match(publish, /rendered-quality-failed/);
  assert.match(renderedQa, /35-55 seconds/);
  assert.match(renderedQa, /first three cells.*opening three seconds/i);
});


test("operation windows call newsletter send directly after a successful generation", async () => {
  const ops = await readFile(new URL("../services/ops/index.js", import.meta.url), "utf8");
  assert.doesNotMatch(ops, /newsletter-readiness.*\/newsletter\/readiness/);
  assert.match(ops, /newsletter-send.*newsletter-generate/);
  assert.match(ops, /operation-dependency-not-ready/);
});

test("Zernio daily posts and mini-series retain exact source evidence", async () => {
  const prompts = await readFile(new URL("../services/zernio/utils/prompts.js", import.meta.url), "utf8");
  const scheduler = await readFile(new URL("../services/zernio/utils/socialScheduler.js", import.meta.url), "utf8");
  assert.match(prompts, /sourceUrls: exact RSS URLs used as factual evidence/);
  assert.match(scheduler, /RSS source fidelity/);
  assert.match(scheduler, /generated-series-quality-failed/);
  assert.match(scheduler, /Exact source evidence/);
});

test("social-blog Phase 5 repairs rebuild and revalidate the published artefact", async () => {
  const source = await readFile(new URL("../services/blog/social/buildDailySocialBlogPost.js", import.meta.url), "utf8");
  assert.match(source, /post-review-brand-topic-regression/);
  assert.match(source, /phase5-repair-regressed-phase4/);
  assert.match(source, /phase5-repair-final-validation-failed/);
  assert.match(source, /Social blog fallback failed brand\/topicality QA/);
  assert.match(source, /Exact source evidence for visual grounding/);
});

test("artwork QA downgrades speculative pixel concerns but blocks observed defects", () => {
  const speculative = normaliseArtworkVisualQa({
    score: 88,
    relevance: 90,
    textSafety: 94,
    composition: 86,
    brandFit: 87,
    defects: [],
    hardDefects: ["Possible tiny glyph on a device; cannot confirm at this zoom"],
    summary: "Otherwise usable",
  });
  assert.equal(speculative.pass, true);
  assert.equal(speculative.hardDefects.length, 0);
  assert.equal(speculative.defects.length, 1);

  const observed = normaliseArtworkVisualQa({
    score: 90,
    relevance: 92,
    textSafety: 95,
    composition: 90,
    brandFit: 88,
    defects: [],
    hardDefects: ["Clearly readable alphanumeric label on the cable"],
    summary: "Observed text",
  });
  assert.equal(observed.pass, false);
  assert.equal(observed.hardDefects.length, 1);
});

test("artwork lanes have separate total budgets and AI-grounded photorealistic prompts", async () => {
  const core = await readFile(new URL("../services/artwork/utils/artwork.js", import.meta.url), "utf8");
  const blog = await readFile(new URL("../services/artwork/createBlogArtwork.js", import.meta.url), "utf8");
  const social = await readFile(new URL("../services/artwork/createSocialArtwork.js", import.meta.url), "utf8");
  const env = await readFile(new URL("../config/production.defaults.env", import.meta.url), "utf8");
  assert.match(core, /photorealistic artificial-intelligence editorial blog hero/i);
  assert.match(core, /Never use anime/i);
  assert.match(blog, /NEWSLETTER_ARTWORK_TIMEOUT_MS/);
  assert.match(blog, /SOCIAL_BLOG_ARTWORK_TIMEOUT_MS/);
  assert.match(social, /ZERNIO_ARTWORK_TIMEOUT_MS/);
  assert.match(env, /^ARTWORK_REQUEST_TIMEOUT_MS=120000$/m);
  assert.match(env, /^NEWSLETTER_ARTWORK_TIMEOUT_MS=600000$/m);
  assert.match(env, /^ZERNIO_ARTWORK_TIMEOUT_MS=600000$/m);
});

test("newsletter proceeds only when artwork service returns a usable generated or deterministic image", async () => {
  const hero = await readFile(new URL("../services/newsletter/engine/heroImage.js", import.meta.url), "utf8");
  const build = await readFile(new URL("../services/newsletter/engine/buildNewsletter.js", import.meta.url), "utf8");
  assert.match(hero, /createBlogArtwork/);
  assert.match(hero, /if \(!result\.ok\)/);
  assert.match(hero, /return \{ ok: false, error: result\.error, prompt \}/);
  assert.doesNotMatch(hero, /NEWSLETTER_AI_EDGE_FALLBACK_IMAGE_URL/);
  assert.match(build, /if \(!heroImageResult\.ok\)/);
  assert.match(build, /Newsletter editorial content passed but hero image generation failed/);
});

test("paid Blotato renders survive QA plumbing failures and rendered QA uses structured output", async () => {
  const publish = await readFile(new URL("../services/blotato/utils/autoPublishService.js", import.meta.url), "utf8");
  const qa = await readFile(new URL("../services/blotato/utils/renderedVideoQa.js", import.meta.url), "utf8");
  const env = await readFile(new URL("../config/production.defaults.env", import.meta.url), "utf8");
  assert.match(publish, /getJobsByType/);
  assert.match(publish, /reusableRenderedVideo/);
  assert.match(publish, /job\.renderedVideoQa\?\.pass === true/);
  assert.match(publish, /blotato\.render_reuse\.hit/);
  assert.match(publish, /BLOTATO_RENDERED_QA_BLOCK_SOFT_FAILURES/);
  assert.match(publish, /blotato\.finished_video\.qa_soft_failure_accepted/);
  assert.match(qa, /strictJsonResponseFormat\("blotato_rendered_video_qa"/);
  assert.match(qa, /max_tokens: 1400/);
  assert.match(qa, /BLOTATO_RENDERED_QA_JSON_ATTEMPTS/);
  assert.match(qa, /qa_infrastructure_fallback/);
  assert.match(env, /^BLOTATO_RENDERED_QA_JSON_ATTEMPTS=2$/m);
  assert.match(env, /^BLOTATO_RENDERED_QA_INFRASTRUCTURE_FALLBACK=true$/m);
  assert.match(env, /^BLOTATO_RENDERED_QA_BLOCK_SOFT_FAILURES=false$/m);
  assert.match(env, /^BLOTATO_RENDER_REUSE_MAX_AGE_MS=21600000$/m);
});

test("newsletter council cannot burn a rewrite merely because verdict text contradicts a passing score", async () => {
  const council = await readFile(new URL("../services/newsletter/engine/editorialCouncil.js", import.meta.url), "utf8");
  assert.match(council, /blocking: \{ type: "boolean" \}/);
  assert.match(council, /reviewerScore >= THRESHOLDS\.newsletter\.qaPassThreshold && !blocking/);
  assert.match(council, /!review\.blocking && review\.score >= THRESHOLDS\.newsletter\.qaPassThreshold/);
  assert.match(council, /!chairBlocking && chairScore >= THRESHOLDS\.newsletter\.qaPassThreshold/);
});

test("Zernio and Blotato scheduled publishing require provider confirmation", async () => {
  const zernio = await readFile(new URL("../services/zernio/utils/socialScheduler.js", import.meta.url), "utf8");
  const blotato = await readFile(new URL("../services/blotato/utils/autoPublishService.js", import.meta.url), "utf8");
  const blotatoRoutes = await readFile(new URL("../services/blotato/routes/index.js", import.meta.url), "utf8");
  const blotatoClient = await readFile(new URL("../services/blotato/utils/blotatoClient.js", import.meta.url), "utf8");
  const zernioClient = await readFile(new URL("../services/zernio/utils/zernioClient.js", import.meta.url), "utf8");
  const env = await readFile(new URL("../config/production.defaults.env", import.meta.url), "utf8");
  const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");
  assert.match(zernio, /verifyZernioScheduleResponse/);
  assert.match(zernio, /ZERNIO_SCHEDULE_ACCEPTED_STATUSES = new Set\(\["scheduled"\]\)/);
  assert.match(zernio, /Zernio did not confirm the scheduled post/);
  assert.match(zernio, /remoteMs !== null && Math\.abs\(remoteMs - expectedMs\) <= toleranceMs/);
  assert.match(zernio, /ZERNIO_REQUIRE_IMAGE/);
  assert.match(zernio, /zernio-image-required/);
  assert.match(zernio, /zernio\.mini_series\.part_schedule_failed/);
  assert.match(zernio, /ZERNIO_MINI_SERIES_SCHEDULE_ATTEMPTS/);
  assert.match(blotato, /POST_SCHEDULE_ACCEPTED_STATUSES = new Set\(\["scheduled"\]\)/);
  assert.match(blotato, /scheduled submission/);
  assert.match(blotato, /phase: "pre-publish"/);
  assert.match(blotato, /blotato-scheduled-publishing-required/);
  assert.match(blotatoRoutes, /requireScheduledBlotatoRoute/);
  assert.match(blotatoRoutes, /\/autoshorts\/schedule/);
  assert.match(blotatoRoutes, /\/shorts\/:lane\/schedule/);
  assert.match(env, /^BLOTATO_REQUIRE_ALL_CHANNELS=true$/m);
  assert.match(env, /^BLOTATO_ALLOW_IMMEDIATE_PUBLISH=false$/m);
  assert.match(env, /^ZERNIO_REQUIRE_SCHEDULE_CONFIRMATION=true$/m);
  assert.match(env, /^ZERNIO_REQUIRE_IMAGE=true$/m);
  assert.match(blotatoClient, /BLOTATO_KEY_ENV_NAMES = \["BLOTATO_API_KEY", "Blotato_API_key"\]/);
  assert.match(zernioClient, /export async function listAccountsHealth/);
  assert.match(zernioClient, /canPost === false/);
  assert.match(envExample, /^ZERNIO_DEFAULT_DRY_RUN=false$/m);
});

test("Zernio exact schedules use London time and recover missed slots with a safe lead", async () => {
  const summer = zonedDateTimeToUtcDate("2026-08-03 12:00", "Europe/London");
  const winter = zonedDateTimeToUtcDate("2026-01-15 12:00", "Europe/London");
  assert.equal(summer.toISOString(), "2026-08-03T11:00:00.000Z");
  assert.equal(winter.toISOString(), "2026-01-15T12:00:00.000Z");
  assert.equal(zonedDateTimeString(summer, "Europe/London"), "2026-08-03 12:00");

  const scheduler = await readFile(new URL("../services/zernio/utils/socialScheduler.js", import.meta.url), "utf8");
  const config = await readFile(new URL("../services/zernio/utils/config.js", import.meta.url), "utf8");
  const env = await readFile(new URL("../config/production.defaults.env", import.meta.url), "utf8");
  assert.match(scheduler, /resolveZernioScheduledDateTime/);
  assert.match(scheduler, /zernio\.schedule\.slot_recovered/);
  assert.match(scheduler, /zernio-schedule-slot-missed/);
  assert.match(config, /ZERNIO_BLOG_RSS_TIME, "12:00"/);
  assert.match(env, /^ZERNIO_SCHEDULE_RECOVERY_ENABLED=true$/m);
  assert.match(env, /^ZERNIO_SCHEDULE_MIN_LEAD_MS=900000$/m);
  assert.match(env, /^ZERNIO_BLOG_RSS_TIME=12:00$/m);
  assert.match(env, /^ZERNIO_API_RETRY_ATTEMPTS=5$/m);
});

test("Zernio retains diagnostic artwork support but does not publish a static fallback by default", async () => {
  const png = createDeterministicAiFallbackPng({ width: 640, height: 360, seed: "newsletter-ai-edge" });
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.length > 20_000);

  const blogArtwork = await readFile(new URL("../services/artwork/createBlogArtwork.js", import.meta.url), "utf8");
  const socialArtwork = await readFile(new URL("../services/artwork/createSocialArtwork.js", import.meta.url), "utf8");
  const zernioScheduler = await readFile(new URL("../services/zernio/utils/socialScheduler.js", import.meta.url), "utf8");
  const weeklyBlog = await readFile(new URL("../services/blog/weekly/buildWeeklyBlogPost.js", import.meta.url), "utf8");
  const socialBlog = await readFile(new URL("../services/blog/social/buildDailySocialBlogPost.js", import.meta.url), "utf8");
  const hero = await readFile(new URL("../services/newsletter/engine/heroImage.js", import.meta.url), "utf8");
  const env = await readFile(new URL("../config/production.defaults.env", import.meta.url), "utf8");
  assert.match(blogArtwork, /artwork\.blog\.deterministic_ai_diagnostic/);
  assert.match(socialArtwork, /artwork\.social\.deterministic_ai_diagnostic/);
  assert.match(blogArtwork, /SOCIAL_BLOG_ALLOW_DETERMINISTIC_FALLBACK/);
  assert.match(blogArtwork, /NEWSLETTER_ALLOW_DETERMINISTIC_FALLBACK/);
  assert.match(blogArtwork, /ok: publishableFallback,[\s\S]*diagnosticUrl: publicUrl,[\s\S]*publicUrl: publishableFallback \? publicUrl : ""/);
  assert.match(socialArtwork, /ZERNIO_ALLOW_DETERMINISTIC_FALLBACK/);
  assert.match(socialArtwork, /allowFallback = false/);
  assert.match(socialArtwork, /if \(!allowFallback\)/);
  assert.match(socialArtwork, /ok: publishableFallback,[\s\S]*diagnosticUrl: publicUrl,[\s\S]*publicUrl: publishableFallback \? publicUrl : ""/);
  assert.match(zernioScheduler, /fallbackUrl: lane\.imageUrl/);
  assert.match(zernioScheduler, /allowFallback: booleanValue\(process\.env\.ZERNIO_ALLOW_CURATED_ARTWORK_FALLBACK, false\)/);
  assert.match(zernioScheduler, /artwork\.fallback/);
  assert.match(weeklyBlog, /reason: "artwork-unavailable"/);
  assert.match(socialBlog, /reason: "artwork-unavailable"/);
  assert.match(socialBlog, /!art\.fallback/);
  assert.doesNotMatch(hero, /blog-fallback-hero\.png/);
  assert.match(env, /^BLOG_FALLBACK_IMAGE_URL=$/m);
  assert.match(env, /^BLOG_SOCIAL_FALLBACK_IMAGE_URL=$/m);
  assert.match(env, /^NEWSLETTER_AI_EDGE_FALLBACK_IMAGE_URL=$/m);
  assert.match(env, /^SOCIAL_BLOG_ALLOW_DETERMINISTIC_FALLBACK=false$/m);
  assert.match(env, /^NEWSLETTER_ALLOW_DETERMINISTIC_FALLBACK=true$/m);
  assert.match(env, /^ZERNIO_ALLOW_CURATED_ARTWORK_FALLBACK=false$/m);
  assert.match(env, /^ZERNIO_ALLOW_DETERMINISTIC_FALLBACK=false$/m);
});


test("social providers are production schedule-only and the weekday window owns the complete social chain", async () => {
  const blotatoRoutes = await readFile(new URL("../services/blotato/routes/index.js", import.meta.url), "utf8");
  const ops = await readFile(new URL("../services/ops/index.js", import.meta.url), "utf8");
  const env = await readFile(new URL("../config/production.defaults.env", import.meta.url), "utf8");

  assert.match(blotatoRoutes, /return configured && !production;/);
  assert.match(env, /^BLOTATO_ALLOW_IMMEDIATE_PUBLISH=false$/m);
  assert.match(env, /^BLOTATO_SCHEDULE_RECOVERY_ENABLED=true$/m);
  assert.match(env, /^AIMS_OPERATION_AUTO_RECOVERY_ENABLED=true$/m);
  for (const contract of [
    '["blotato-am", "/blotato/autoshorts/schedule"',
    '["zernio-monday", "/zernio/daily/monday"',
    '["blog-social", "/blog/social/daily/build"',
    '["zernio-blog-social", "/zernio/blog-rss/daily"',
    '["blotato-pm", "/blotato/shorts/news-insight/schedule"',
  ]) assert.ok(ops.includes(contract), `missing social operation task: ${contract}`);
  assert.ok(ops.includes('const DEFERRED_OPERATION_TASKS = new Set();'));
});

test("mini-series creation retries weak plans and duplicate parts, then fails closed before partial scheduling", async () => {
  const scheduler = await readFile(new URL("../services/zernio/utils/socialScheduler.js", import.meta.url), "utf8");
  const client = await readFile(new URL("../services/zernio/utils/zernioClient.js", import.meta.url), "utf8");
  const env = await readFile(new URL("../config/production.defaults.env", import.meta.url), "utf8");
  assert.match(scheduler, /ZERNIO_MINI_SERIES_THEME_ATTEMPTS/);
  assert.match(scheduler, /zernio\.mini_series\.theme_retry/);
  assert.match(scheduler, /ZERNIO_MINI_SERIES_DISTINCTNESS_ATTEMPTS/);
  assert.match(scheduler, /zernio\.mini_series\.distinctness_retry/);
  assert.match(scheduler, /scope: "mini-series:weekly"/);
  assert.match(scheduler, /zernio\.mini_series\.duplicate_prevented/);
  assert.match(scheduler, /idempotencySeed: slotClaim\.key \|\| ""/);
  assert.match(scheduler, /reason: "generated-series-quality-failed"/);
  assert.match(scheduler, /ok: false,\n\s+quarantined: true,\n\s+lane: "weekly-mini-series"/);
  assert.match(scheduler, /fallbackUrl: MINI_SERIES_CONFIG\.fallbackImageUrl/);
  assert.match(scheduler, /reason: "mini-series-artwork-failed"/);
  assert.match(scheduler, /await deletePost\(remoteId, apiKey\)/);
  assert.match(scheduler, /mini-series-incomplete-rolled-back/);
  assert.match(scheduler, /clearScheduleSlotClaim/);
  assert.match(client, /export async function deletePost/);
  assert.match(client, /"x-request-id": requestId/);
  assert.match(scheduler, /zernio-daily-artwork-unavailable/);
  assert.match(scheduler, /allowFallback: booleanValue\(process\.env\.ZERNIO_ALLOW_CURATED_ARTWORK_FALLBACK, false\)/);
  assert.doesNotMatch(scheduler, /!artwork\?\.ok \|\| !artwork\.publicUrl \|\| artwork\.fallback/);
  assert.match(env, /^ZERNIO_MINI_SERIES_THEME_ATTEMPTS=3$/m);
  assert.match(env, /^ZERNIO_MINI_SERIES_DISTINCTNESS_ATTEMPTS=3$/m);
});

test("critical orchestration defaults stay aligned across deployment templates", async () => {
  const files = await Promise.all([
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../env.template", import.meta.url), "utf8"),
    readFile(new URL("../config/production.defaults.env", import.meta.url), "utf8"),
  ]);
  const parse = (text) => Object.fromEntries(text.split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.trimStart().startsWith("#"))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }));
  const configs = files.map(parse);
  const expected = {
    ARTWORK_TASK_TIMEOUT_MS: "600000",
    ARTWORK_REQUEST_TIMEOUT_MS: "120000",
    BLOG_ARTWORK_TIMEOUT_MS: "600000",
    NEWSLETTER_ARTWORK_TIMEOUT_MS: "600000",
    SOCIAL_BLOG_ARTWORK_TIMEOUT_MS: "600000",
    ZERNIO_ARTWORK_TIMEOUT_MS: "600000",
    BLOG_FALLBACK_IMAGE_URL: "",
    BLOG_SOCIAL_FALLBACK_IMAGE_URL: "",
    NEWSLETTER_AI_EDGE_FALLBACK_IMAGE_URL: "",
    ZERNIO_REQUIRE_SCHEDULE_CONFIRMATION: "true",
    ZERNIO_REQUIRE_IMAGE: "true",
    ZERNIO_REQUIRED_PLATFORMS: "facebook,instagram",
    ZERNIO_MONDAY_TIME: "14:00",
    ZERNIO_TUESDAY_TIME: "13:00",
    ZERNIO_WEDNESDAY_TIME: "12:20",
    ZERNIO_THURSDAY_TIME: "12:20",
    ZERNIO_FRIDAY_TIME: "11:20",
    ZERNIO_SATURDAY_TIME: "10:30",
    ZERNIO_SUNDAY_TIME: "18:00",
    ZERNIO_EBOOK_TUESDAY_TIME: "16:00",
    ZERNIO_EBOOK_THURSDAY_TIME: "15:30",
    ZERNIO_EBOOK_SATURDAY_TIME: "14:30",
    ZERNIO_QUIZ_QUESTION_TIME: "12:00",
    ZERNIO_QUIZ_ANSWER_TIME: "12:00",
    ZERNIO_MINI_SERIES_TUESDAY_TIME: "19:30",
    ZERNIO_MINI_SERIES_WEDNESDAY_TIME: "19:30",
    ZERNIO_MINI_SERIES_THURSDAY_TIME: "20:00",
    ZERNIO_MINI_SERIES_FRIDAY_TIME: "19:30",
    ZERNIO_MINI_SERIES_SATURDAY_TIME: "19:30",
    ZERNIO_MINI_SERIES_SUNDAY_TIME: "19:30",
    ZERNIO_PODCAST_PROMO_TIME: "18:30",
    ZERNIO_ALLOW_CURATED_ARTWORK_FALLBACK: "false",
    ZERNIO_ALLOW_DETERMINISTIC_FALLBACK: "false",
    ZERNIO_SCHEDULE_RECOVERY_ENABLED: "true",
    ZERNIO_SCHEDULE_MIN_LEAD_MS: "900000",
    ZERNIO_BLOG_RSS_TIME: "12:00",
    BLOTATO_REQUIRE_ALL_CHANNELS: "true",
    BLOTATO_ALLOW_IMMEDIATE_PUBLISH: "false",
    BLOTATO_SCHEDULE_TIMEZONE: "Europe/London",
    BLOTATO_SCHEDULE_MONDAY_AM: "10:30",
    BLOTATO_SCHEDULE_MONDAY_PM: "18:30",
    BLOTATO_SCHEDULE_TUESDAY_AM: "10:30",
    BLOTATO_SCHEDULE_TUESDAY_PM: "18:30",
    BLOTATO_SCHEDULE_WEDNESDAY_AM: "10:30",
    BLOTATO_SCHEDULE_WEDNESDAY_PM: "19:00",
    BLOTATO_SCHEDULE_THURSDAY_AM: "10:30",
    BLOTATO_SCHEDULE_THURSDAY_PM: "19:00",
    BLOTATO_SCHEDULE_FRIDAY_AM: "10:30",
    BLOTATO_SCHEDULE_FRIDAY_PM: "16:30",
    BLOTATO_SCHEDULE_MIN_LEAD_MS: "900000",
    BLOTATO_SCHEDULE_RECOVERY_ENABLED: "true",
    BLOTATO_RENDERED_QA_BLOCK_SOFT_FAILURES: "false",
    BLOTATO_SCHEDULE_VERIFY_ATTEMPTS: "12",
    AIMS_OPERATION_NEWSLETTER_ENABLED: "true",
    AIMS_OPERATION_AUTO_RECOVERY_ENABLED: "true",
    AIMS_OPERATION_MAX_ATTEMPTS: "3",
    AIMS_OPERATION_RECOVERY_COOLDOWN_MS: "60000",
    REVIEW_COUNCIL_STAGNATION_LIMIT: "2",
  };
  for (const [key, value] of Object.entries(expected)) {
    for (const config of configs) assert.equal(config[key], value, `${key} must match every deployment template`);
  }
});
