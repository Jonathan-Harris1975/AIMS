import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildBlotatoCreditFallbackSlideHtml,
  buildBlotatoCreditFallbackSlides,
  isBlotatoCreditLimitError,
  renderScheduledBlotatoVideo,
} from "../services/blotato/utils/localCreditFallbackVideo.js";

test("local Blotato fallback preserves the hook, story points, source and branded CTA", () => {
  const slides = buildBlotatoCreditFallbackSlides({
    youtubeTitle: "AI changes a real workflow",
    hook: "A practical question about AI",
    scenes: [
      { script: "The source describes a new deployment." },
      { script: "The important constraint is human review." },
      { script: "Measure the result before expanding." },
    ],
    angle: "Keep a human checkpoint.",
    cta: "Follow for practical AI analysis.",
  }, { title: "Source article" });
  assert.equal(slides.length, 5);
  assert.equal(slides[0].body, "A practical question about AI");
  assert.ok(slides.some((slide) => slide.body === "The important constraint is human review."));
  assert.equal(slides[0].source, "Source article");
  assert.equal(slides[4].body, "Keep a human checkpoint.");
});

test("fallback slide HTML escapes source content before rendering", () => {
  const html = buildBlotatoCreditFallbackSlideHtml({
    title: "<img src=x>",
    body: "A & B <script>alert(1)</script>",
    index: 1,
    count: 5,
  });
  assert.doesNotMatch(html, /<img src=x>|<script>/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.match(html, /A &amp; B &lt;script&gt;/);
});

test("known provider and monthly credit limits select a local render and never call paid rendering", async () => {
  assert.equal(isBlotatoCreditLimitError({ code: "blotato-monthly-estimated-credit-cap" }), true);
  assert.equal(isBlotatoCreditLimitError({ code: "insufficient_credits" }), true);
  let paid = 0;
  let fallback = 0;
  const result = await renderScheduledBlotatoVideo({
    reservePaidRender: async () => { throw Object.assign(new Error("monthly cap"), { code: "blotato-monthly-estimated-credit-cap" }); },
    renderPaidVideo: async () => { paid += 1; return { mediaUrl: "https://paid.example/video.mp4" }; },
    renderLocalFallback: async ({ code }) => { fallback += 1; return { mediaUrl: "https://assets.example/fallback.mp4", fallbackReason: code }; },
  });
  assert.equal(paid, 0);
  assert.equal(fallback, 1);
  assert.equal(result.video.mediaUrl, "https://assets.example/fallback.mp4");
  assert.equal(result.video.localCreditFallback, true);
  assert.equal(result.creditFallback.scheduledWithoutPaidRender, true);
});

test("non-credit failures remain visible and do not invoke fallback", async () => {
  let fallback = 0;
  await assert.rejects(() => renderScheduledBlotatoVideo({
    reservePaidRender: async () => { throw new Error("R2 is unavailable"); },
    renderPaidVideo: async () => ({ mediaUrl: "https://paid.example/video.mp4" }),
    renderLocalFallback: async () => { fallback += 1; return { mediaUrl: "https://assets.example/fallback.mp4" }; },
  }), /R2 is unavailable/);
  assert.equal(fallback, 0);
});

test("scheduled Blotato orchestration wires the cap fallback into publishing", async () => {
  const source = await readFile(new URL("../services/blotato/utils/autoPublishService.js", import.meta.url), "utf8");
  assert.match(source, /renderScheduledBlotatoVideo/);
  assert.match(source, /createLocalBlotatoCreditFallbackVideo/);
  assert.match(source, /phase: "local-credit-fallback-ready"/);
  assert.match(source, /mediaUrl: video\.mediaUrl/);
});
