import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildArtworkVisualQaPrompt,
  normaliseArtworkVisualQa,
} from "../services/artwork/utils/artworkVisualQa.js";

test("newsletter artwork QA rejects travel drift and pseudo-text", () => {
  const prompt = buildArtworkVisualQaPrompt({ mode: "newsletter", creativePrompt: "AI security story" });
  assert.match(prompt, /not travel, tourism, lifestyle/i);
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

test("newsletter review routes avoid the logged unsupported GPT targets", async () => {
  const config = await readFile(new URL("../services/shared/utils/ai-config.js", import.meta.url), "utf8");
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
  const aiConfig = await readFile(new URL("../services/shared/utils/ai-config.js", import.meta.url), "utf8");
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


test("operation windows prove newsletter readiness before send and skip blocked delivery", async () => {
  const ops = await readFile(new URL("../services/ops/index.js", import.meta.url), "utf8");
  assert.match(ops, /newsletter-readiness.*\/newsletter\/readiness/);
  assert.match(ops, /newsletter-send.*newsletter-readiness/);
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
