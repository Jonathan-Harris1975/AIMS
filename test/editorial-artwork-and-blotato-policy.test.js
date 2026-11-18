import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

test("production forbids reusable artwork across all editorial channels", () => {
  const env = source("config/production.defaults.env");
  for (const setting of [
    "ZERNIO_ALLOW_CURATED_ARTWORK_FALLBACK=false",
    "ZERNIO_ALLOW_DETERMINISTIC_FALLBACK=false",
    "BLOG_ALLOW_DETERMINISTIC_FALLBACK=false",
    "SOCIAL_BLOG_ALLOW_DETERMINISTIC_FALLBACK=false",
    "NEWSLETTER_ALLOW_DETERMINISTIC_FALLBACK=false",
    "NEWSLETTER_HERO_IMAGE_REQUIRED=true",
  ]) {
    assert.ok(env.split("\n").includes(setting), `Missing image publication policy: ${setting}`);
  }
  const artwork = source("services/artwork/createSocialArtwork.js");
  assert.doesNotMatch(artwork, /imageStatus: "curated-static-fallback"/);
  assert.doesNotMatch(artwork, /imageStatus: "deterministic-fallback"/);
  assert.match(artwork, /type: "fresh_artwork_required"/);
  assert.match(artwork, /ok: false,[\s\S]*?imageStatus: "generation-failed"/);

  const podcast = source("services/artwork/createPodcastArtwork.js");
  assert.doesNotMatch(podcast, /pickDeterministicFallbackUrl/);
  assert.match(podcast, /imageGenerationStatus: "failed"/);
  assert.match(source("services/podcast/runPodcastPipeline.js"), /artwork\?\.source !== "generated"/);
  assert.match(source("services/newsletter/engine/buildNewsletter.js"), /const requireHeroImage = true/);
});

test("only ebook promotion posts reuse the original book cover", () => {
  const scheduler = source("services/zernio/utils/socialScheduler.js");
  const ebookStart = scheduler.indexOf("async function buildAndScheduleEbookWeeklyImpl");
  const ebookEnd = scheduler.indexOf("function parseQuizQuestionCard", ebookStart);
  assert.ok(ebookStart > -1 && ebookEnd > ebookStart);
  const ebooks = scheduler.slice(ebookStart, ebookEnd);
  assert.match(ebooks, /const imageUrl = featuredBook\.coverArtUrl;/);
  assert.match(ebooks, /post\.imageUrl = featuredBook\.coverArtUrl;/);
  assert.match(ebooks, /post\.imageStatus = "original-book-cover"/);
  assert.match(ebooks, /zernio-ebook-original-cover-required/);
  assert.doesNotMatch(ebooks, /createSocialArtwork\(/);
  assert.doesNotMatch(ebooks, /options\.imageUrl \|\| featuredBook\.coverArtUrl/);
});

test("other Zernio post formats require newly generated artwork", () => {
  const scheduler = source("services/zernio/utils/socialScheduler.js");
  assert.match(scheduler, /artwork\.fallback \|\| artwork\.imageStatus !== "generated"/);
  assert.match(scheduler, /zernio-quiz-artwork-structure-invalid/);
  assert.doesNotMatch(scheduler, /allowFallback: true/);
  assert.doesNotMatch(scheduler, /allowFallback: allowCuratedArtworkFallback/);
});

test("daily Blotato guarantees two independent slots with a bounded render recovery budget", () => {
  const env = source("config/production.defaults.env");
  for (const setting of [
    "BLOTATO_DAILY_PAID_RENDER_CAP=4",
    "BLOTATO_FRIDAY_PAID_RENDER_CAP=8",
    "BLOTATO_FAILED_RENDER_REPLACEMENTS=1",
  ]) assert.ok(env.split("\n").includes(setting), `Missing Blotato recovery policy: ${setting}`);

  const ops = source("services/ops/index.js");
  for (const weekday of ["monday","tuesday","wednesday","thursday","friday"]) {
    const start = ops.indexOf(`"${weekday}-am": [`);
    const finish = ops.indexOf("\n  ],", start);
    assert.ok(start > 0 && finish > start, `Missing weekday ${weekday} window`);
    const window = ops.slice(start,finish);
    assert.match(window, /\["blotato-am", "\/blotato\/autoshorts\/schedule"/);
    assert.match(window, /\["blotato-pm", "\/blotato\/shorts\//);
  }
  for (const slot of ["saturday/am","saturday/pm","sunday/am","sunday/pm"]) {
    assert.ok(ops.includes(`/blotato/weekend/${slot}/schedule`));
  }
});
