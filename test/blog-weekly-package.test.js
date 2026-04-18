import test from "node:test";
import assert from "node:assert/strict";

import {
  cleanSourceTitle,
  cleanSourceText,
  parseStructuredWeeklyPackage,
  normaliseWeeklyPackage,
  renderWeeklyBodyHtml,
  buildBlogArtworkPrompt,
  buildPostManifestEntry,
  mergePostsManifest,
} from "../services/blog/utils/weeklyPackage.js";

test("cleanSourceTitle removes prefixes and decodes entities", () => {
  const cleaned = cleanSourceTitle("Title: OpenAI&rsquo;s latest model&nbsp;");
  assert.equal(cleaned, "OpenAI's latest model");
});

test("cleanSourceText strips HTML, anchors, and trailing RSS CTA", () => {
  const cleaned = cleanSourceText("<strong>Title</strong><br/><br/>A short summary.<br/><br/><a href=\"https://example.com\">Read on Jonathan-Harris RSS Feed</a>");
  assert.equal(cleaned, "Title\n\nA short summary.");
});

test("parseStructuredWeeklyPackage extracts JSON from code fences", () => {
  const parsed = parseStructuredWeeklyPackage('```json\n{"title":"Weekly Brief","summary":"Sharp summary.","dominant_themes":["Models"],"sections":[]}\n```');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.title, "Weekly Brief");
});

test("normaliseWeeklyPackage returns safe plain-text sections", () => {
  const weeklyPackage = normaliseWeeklyPackage({
    title: "Headline: The Week in AI",
    summary: "<p>Two-sentence <strong>summary</strong>.</p>",
    dominant_themes: ["Agents", "Costs"],
    sections: [
      {
        heading: "Title: What happened",
        paragraphs: ["<p>Model vendors kept shipping.</p>"],
        bullets: ["<strong>Costs</strong> stayed awkward."],
      },
    ],
  }, {
    week: "2026-W14",
    dateLabel: "31 March 2026 to 6 April 2026",
    items: [],
  });

  assert.equal(weeklyPackage.title, "The Week in AI");
  assert.equal(weeklyPackage.sections[0].heading, "What happened");
  assert.equal(weeklyPackage.sections[0].paragraphs[0], "Model vendors kept shipping.");
  assert.equal(weeklyPackage.sections[0].bullets[0], "Costs stayed awkward.");
});

test("renderWeeklyBodyHtml escapes HTML-sensitive text instead of trusting model HTML", () => {
  const html = renderWeeklyBodyHtml({
    summary: "Signal over <noise>",
    sections: [
      {
        heading: "Section <One>",
        paragraphs: ["2 < 3"],
        bullets: ["Use & keep calm"],
      },
    ],
  });

  assert.match(html, /Signal over &lt;noise&gt;/);
  assert.match(html, /Section &lt;One&gt;/);
  assert.match(html, /2 &lt; 3/);
  assert.match(html, /Use &amp; keep calm/);
  assert.doesNotMatch(html, /<html>/i);
});

test("buildBlogArtworkPrompt uses dominant themes instead of generic wallpaper wording", () => {
  const prompt = buildBlogArtworkPrompt({
    week: "2026-W14",
    title: "What Actually Mattered in AI",
    summary: "Costs and control beat the hype again.",
    dominantThemes: ["Inference costs", "Models", "Regulation"],
  });

  assert.match(prompt, /Inference costs, Models, Regulation/);
  assert.match(prompt, /Do not include text/i);
  assert.match(prompt, /generic glowing-brain wallpaper/i);
});

test("mergePostsManifest keeps latest post first and removes duplicates by week", () => {
  const nextEntry = {
    week: "2026-W14",
    slug: "2026-w14-what-actually-mattered",
    url: "https://example.com/blog/2026-w14-what-actually-mattered/index.html",
    published_at: "2026-04-09T10:00:00.000Z",
  };

  const merged = mergePostsManifest({
    posts: [
      {
        week: "2026-W13",
        slug: "2026-w13-last-week",
        url: "https://example.com/blog/2026-w13-last-week/index.html",
        published_at: "2026-04-02T10:00:00.000Z",
      },
      {
        week: "2026-W14",
        slug: "2026-w14-old-version",
        url: "https://example.com/blog/2026-w14-old-version/index.html",
        published_at: "2026-04-09T09:00:00.000Z",
      },
    ],
  }, nextEntry);

  assert.equal(merged.items.length, 2);
  assert.equal(merged.items[0].week, "2026-W14");
  assert.equal(merged.items[1].week, "2026-W13");
});


test("buildPostManifestEntry writes the website's canonical blog post path contract", () => {
  const entry = buildPostManifestEntry({
    week: "2026-W15",
    slug: "2026-w15-what-actually-mattered",
    title: "What Actually Mattered in AI",
    summary: "Sharp summary.",
    bodyHtml: "<p>Body</p>",
    imageUrl: "https://images.example.com/weekly.png",
    imagePrompt: "Prompt",
    dateLabel: "7 April 2026 to 13 April 2026",
    postUrl: "https://jonathan-harris.online/blog/posts/2026-w15-what-actually-mattered/",
    sources: [{ title: "Source", link: "https://example.com", pubDate: "2026-04-13T08:00:00Z" }],
    dominantThemes: ["Models"],
    publishedAt: "2026-04-14T08:00:00Z",
  });

  assert.equal(entry.path, "/blog/posts/2026-w15-what-actually-mattered/");
  assert.equal(entry.url, "https://jonathan-harris.online/blog/posts/2026-w15-what-actually-mattered/");
  assert.equal(entry.canonical_url, entry.url);
  assert.equal(entry.image, "https://images.example.com/weekly.png");
  assert.equal(entry.source_count, 1);
});
