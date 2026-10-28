import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import {
  buildBlotatoCreditFallbackSlideHtml,
  createLocalBlotatoCreditFallbackVideo,
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
  assert.match(slides[4].body, /Keep a human checkpoint\. Follow for practical AI analysis\./);
});

test("fallback slide HTML escapes source content before rendering", () => {
  const html = buildBlotatoCreditFallbackSlideHtml({
    title: "<img src=x>",
    body: "A & B <script>alert(1)</script>",
    index: 1,
    count: 5,
  });
  assert.equal(html.includes("<img src=x>"), false);
  assert.equal(html.includes("<script>"), false);
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

test("scheduled render infrastructure failures also use the local publishing fallback", async () => {
  let paid = 0;
  let fallback = 0;
  const result = await renderScheduledBlotatoVideo({
    reservePaidRender: async () => ({ reservationId: "reserved" }),
    renderPaidVideo: async () => { paid += 1; throw new Error("renderer unavailable"); },
    renderLocalFallback: async ({ code }) => { fallback += 1; return { mediaUrl: "https://assets.example/fallback.mp4", fallbackReason: code }; },
  });
  assert.equal(paid, 1);
  assert.equal(fallback, 1);
  assert.equal(result.video.mediaUrl, "https://assets.example/fallback.mp4");
  assert.equal(result.creditFallback.creditLimited, false);
  assert.equal(result.creditFallback.fallbackReason, "scheduled-video-render-failed");
  assert.equal(result.creditFallback.code, "scheduled-video-render-failed");
});

test("paid scheduled renders remain primary when credit reservation and renderer succeed", async () => {
  let fallback = 0;
  const result = await renderScheduledBlotatoVideo({
    reservePaidRender: async () => ({ reservationId: "reserved" }),
    renderPaidVideo: async () => ({ mediaUrl: "https://paid.example/video.mp4" }),
    renderLocalFallback: async () => { fallback += 1; return { mediaUrl: "https://assets.example/fallback.mp4" }; },
  });
  assert.equal(result.video.mediaUrl, "https://paid.example/video.mp4");
  assert.equal(result.reservation.reservationId, "reserved");
  assert.equal(result.creditFallback, null);
  assert.equal(fallback, 0);
});

test("scheduled Blotato uses provider scenes and never substitutes local text cards", async () => {
  const source = await readFile(new URL("../services/blotato/utils/autoPublishService.js", import.meta.url), "utf8");
  assert.match(source, /await resolveVideoTemplateId/);
  assert.match(source, /await createAndWaitForVideo/);
  assert.match(source, /reservePaidRender/);
  assert.doesNotMatch(source, /localBlotatoFallbackRenderer|static-card-narration-render-mode/);
  assert.match(source, /const blockHardQaFailures = true/);
});

test("local fallback renderer uploads static visual cards with spoken narration", async () => {
  const htmlPages = [];
  const uploads = [];
  const fakeBrowser = {
    newPage: async () => ({
      setContent: async (html) => { htmlPages.push(html); },
      screenshot: async () => Buffer.from("png-frame"),
    }),
    close: async () => {},
  };
  const result = await createLocalBlotatoCreditFallbackVideo({
    pack: { hook: "A practical AI test", scenes: [{ script: "Check one real workflow." }] },
    article: { title: "Source article" },
    sessionId: "BLT-news-insight-2026-10-26-AM",
    scheduleDate: "2026-10-26",
    loadChromium: async () => ({ chromium: { launch: async () => fakeBrowser } }),
    findChromiumExecutable: async () => "/usr/bin/chromium",
    synthesizeNarration: async (text) => { assert.match(text, /Check one real workflow/); return Buffer.alloc(200, 1); },
    runFfmpeg: async (_command, args) => {
      assert.ok(args.includes("-map"));
      assert.ok(args.includes("-c:a"));
      await writeFile(args.at(-1), Buffer.alloc(21_000, 1));
    },
    upload: async (...args) => {
      uploads.push(args);
      return "https://assets.example/blotato-fallback.mp4";
    },
  });
  assert.equal(htmlPages.length, 5);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0][0], "blogImages");
  assert.equal(uploads[0][3], "video/mp4");
  assert.equal(result.mediaUrl, "https://assets.example/blotato-fallback.mp4");
  assert.equal(result.creditBudget.expectedCredits, 0);
  assert.equal(result.localCreditFallback, true);
  assert.equal(result.staticCardVisuals, true);
  assert.equal(result.audioNarration, true);
  assert.equal(result.narrationProvider, "aws-polly");
});
