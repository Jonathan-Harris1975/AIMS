import assert from "node:assert/strict";
import test from "node:test";
import { getPodcastReadiness } from "../services/podcast/readiness.js";

function completeEnv() {
  return {
    OPENROUTER_API_KEY: "openrouter-key",
    OPENROUTER_CLAUDE_SONNET_5: "anthropic/claude-sonnet-5",
    AWS_ACCESS_KEY_ID: "aws-key",
    AWS_SECRET_ACCESS_KEY: "aws-secret",
    AWS_REGION: "eu-west-2",
    POLLY_VOICE_ID: "Brian",
    R2_ENDPOINT: "https://example.r2.cloudflarestorage.com",
    R2_ACCESS_KEY_ID: "r2-key",
    R2_SECRET_ACCESS_KEY: "r2-secret",
    R2_BUCKET_PODCAST: "podcast",
    R2_BUCKET_CHUNKS: "podcast-chunks",
    R2_BUCKET_MERGED: "podcast-merged",
    R2_BUCKET_EDITED_AUDIO: "edited",
    R2_BUCKET_META: "podcast-meta",
    R2_BUCKET_ART: "podcastart",
    R2_BUCKET_TRANSCRIPTS: "transcripts",
    R2_BUCKET_PODCAST_RSS_FEEDS: "podcast-rss-feeds",
    R2_BUCKET_RAW_TEXT: "raw-text",
    R2_PUBLIC_BASE_URL_PODCAST: "https://podcast.example.com",
    R2_PUBLIC_BASE_URL_ART: "https://art.example.com",
    R2_PUBLIC_BASE_URL_META: "https://meta.example.com",
    R2_PUBLIC_BASE_URL_PODCAST_RSS: "https://rss.example.com",
    R2_PUBLIC_BASE_URL_TRANSCRIPT_HTML: "https://transcripts.example.com",
    PODCAST_INTRO_URL: "https://example.com/intro.mp3",
    PODCAST_OUTRO_URL: "https://example.com/outro.mp3",
    PODCAST_TARGET_MINUTES: "60",
  };
}

test("podcast readiness accepts the complete Friday production contract", () => {
  const report = getPodcastReadiness({ env: completeEnv(), checkCommand: () => true });
  assert.equal(report.ready, true);
  assert.equal(report.targetMinutes, 60);
});

test("podcast readiness fails closed when a production dependency is missing", () => {
  const env = completeEnv();
  delete env.AWS_SECRET_ACCESS_KEY;
  const report = getPodcastReadiness({ env, checkCommand: () => true });
  assert.equal(report.ready, false);
  assert.ok(report.checks.some((check) => check.name === "env:AWS_SECRET_ACCESS_KEY" && check.ok === false));
});

test("podcast readiness rejects a target longer than the governed hour", () => {
  const env = completeEnv();
  env.PODCAST_TARGET_MINUTES = "75";
  const report = getPodcastReadiness({ env, checkCommand: () => true });
  assert.equal(report.ready, false);
  assert.ok(report.checks.some((check) => check.name === "podcast_target_minutes" && check.ok === false));
});


test("podcast readiness rejects non-HTTPS production assets", () => {
  const env = completeEnv();
  env.PODCAST_INTRO_URL = "http://example.com/intro.mp3";
  const report = getPodcastReadiness({ env, checkCommand: () => true });
  assert.equal(report.ready, false);
  assert.ok(report.checks.some((check) => check.name === "podcast_intro_url" && check.ok === false));
});

test("podcast run route cannot bypass readiness", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../services/podcast/index.js", import.meta.url), "utf8");
  assert.match(source, /const readiness = getPodcastReadiness\(\)/);
  assert.match(source, /Podcast dependencies are not ready/);
  assert.match(source, /res\.status\(503\)/);
});
