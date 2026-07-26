import test from "node:test";
import assert from "node:assert/strict";

import {
  mainSiteUrl,
  rewriteLegacyBlogMainSiteLinks,
} from "../services/blog/utils/mainSiteLinks.js";

test("mainSiteUrl points navigation back to the canonical main website", () => {
  assert.equal(
    mainSiteUrl("/podcast/", "https://jonathan-harris.online/"),
    "https://jonathan-harris.online/podcast/",
  );
});

test("legacy blog repair rewrites only known main-site root-relative hrefs", () => {
  const source = `
    <link rel="canonical" href="https://blog.jonathan-harris.online/social-media-blog/posts/example/index.html">
    <a href="/">Home</a>
    <a href="/ebooks/">eBooks</a>
    <a href="/podcast/">Podcast</a>
    <a href="/newsletter/?from=blog">Newsletter</a>
    <a href="#main">Skip</a>
    <a href="/social-media-blog/posts/another/">Another blog post</a>
    <a href="https://example.com/source">Source</a>
    <img src="https://images.jonathan-harris.online/example.png">
  `;

  const repaired = rewriteLegacyBlogMainSiteLinks(source, {
    baseUrl: "https://jonathan-harris.online",
  });

  assert.equal(repaired.changed, true);
  assert.equal(repaired.replacements, 4);
  assert.match(repaired.html, /href="https:\/\/jonathan-harris\.online\/"/);
  assert.match(repaired.html, /href="https:\/\/jonathan-harris\.online\/ebooks\/"/);
  assert.match(repaired.html, /href="https:\/\/jonathan-harris\.online\/podcast\/"/);
  assert.match(repaired.html, /href="https:\/\/jonathan-harris\.online\/newsletter\/\?from=blog"/);

  // The blog's own canonical/public URL stays on blog.*.
  assert.match(
    repaired.html,
    /href="https:\/\/blog\.jonathan-harris\.online\/social-media-blog\/posts\/example\/index\.html"/,
  );

  // Non-main-site and in-page links are untouched.
  assert.match(repaired.html, /href="#main"/);
  assert.match(repaired.html, /href="\/social-media-blog\/posts\/another\/"/);
  assert.match(repaired.html, /href="https:\/\/example\.com\/source"/);
  assert.match(repaired.html, /src="https:\/\/images\.jonathan-harris\.online\/example\.png"/);
});

test("legacy blog repair is idempotent", () => {
  const first = rewriteLegacyBlogMainSiteLinks(
    '<a href="/contact/">Contact</a>',
    { baseUrl: "https://jonathan-harris.online" },
  );
  const second = rewriteLegacyBlogMainSiteLinks(
    first.html,
    { baseUrl: "https://jonathan-harris.online" },
  );

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(second.replacements, 0);
  assert.equal(second.html, first.html);
});
