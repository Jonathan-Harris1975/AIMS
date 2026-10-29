import test from "node:test";
import assert from "node:assert/strict";
import { isGeneratedSocialBlogArtwork } from "../services/blog/social/buildDailySocialBlogPost.js";

test("today's geometric fallback is rejected even when its upload succeeded", () => {
  assert.equal(isGeneratedSocialBlogArtwork({ ok: true, fallback: true, imageStatus: "deterministic-fallback",
    publicUrl: "https://images.example/BLOG-SOCIAL-2026-10-29-artwork-repair-ai-fallback.png" }), false);
  assert.equal(isGeneratedSocialBlogArtwork({ ok: true, imageStatus: "deterministic-fallback", publicUrl: "https://images.example/fallback.png" }), false);
});

test("only a usable generated image satisfies the social-blog publication requirement", () => {
  assert.equal(isGeneratedSocialBlogArtwork({ ok: true, publicUrl: "https://images.example/source-specific.jpg" }), true);
  assert.equal(isGeneratedSocialBlogArtwork({ ok: false, publicUrl: "https://images.example/diagnostic.png" }), false);
  assert.equal(isGeneratedSocialBlogArtwork({ ok: true, publicUrl: "" }), false);
});
