import test from "node:test";
import assert from "node:assert/strict";
import { parseEnvLines, validateEnvEntries, validateEnvObject } from "../scripts/koyebEnvDoctor.js";

test("koyeb env doctor accepts Koyeb bulk-edit secret references", () => {
  const { entries } = parseEnvLines("BLOTATO_API_KEY={{ secret.BLOTATO_API_KEY }}\n");

  assert.deepEqual(validateEnvEntries(entries), []);
});

test("koyeb env doctor accepts compact CLI secret references", () => {
  const { entries } = parseEnvLines("BLOTATO_API_KEY={{secret.BLOTATO_API_KEY}}\n");

  assert.deepEqual(validateEnvEntries(entries), []);
});

test("koyeb env doctor rejects invalid secret names", () => {
  const { entries } = parseEnvLines("BLOTATO_API_KEY={{ secret.BLOTATO-API-KEY }}\n");
  const errors = validateEnvEntries(entries);

  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Invalid Koyeb secret reference/i);
});

test("koyeb env doctor rejects truncated Blotato template ids", () => {
  const { entries } = parseEnvLines(
    "BLOTATO_NEWS_TEMPLATE_ID=/base/v2/ai-story-video/5903fe43-514d-40ee-a060-0d662...\n"
  );
  const errors = validateEnvEntries(entries);

  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /truncated/i);
});


test("koyeb env doctor rejects generic truncated env values", () => {
  const { entries } = parseEnvLines("PODCAST_RSS_FEED_URL=https://podcast-rss-feeds.jonathan-harris.online/turing-...\n");
  const errors = validateEnvEntries(entries);

  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /truncated/i);
});

test("koyeb env doctor rejects malformed URL hostnames", () => {
  const { entries } = parseEnvLines("R2_PUBLIC_BASE_URL_META_SYSTEM=https://pub-f1af4f)6cf4c14d58abaf43112176431b.r2.dev\n");
  const errors = validateEnvEntries(entries);

  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /invalid URL hostname/i);
});

test("koyeb env doctor validates the narrowed Blotato/state env set", () => {
  const errors = validateEnvObject({
    PHASE3_AUTOPUBLISH_MIN_SCORE: "85",
    PHASE3_SOURCE_MIN_CHARS: "180",
    PHASE3_MAX_SENTENCE_WORDS: "34",
    PHASE3_MAX_PODCAST_SENTENCE_WORDS: "26",
    STATE_BACKEND: "auto",
    ALLOW_EPHEMERAL_STATE: "false",
    BLOTATO_DEFAULT_CHANNELS: "instagram,youtube",
    BLOTATO_YOUTUBE_PRIVACY_STATUS: "public",
    BLOTATO_YOUTUBE_NOTIFY_SUBSCRIBERS: "false",
    BLOTATO_INSTAGRAM_SHARE_TO_FEED: "true",
    BLOTATO_NEWS_TEMPLATE_ID: "/base/v2/ai-story-video/5903fe43-514d-40ee-a060-0d6628c5f8fd/v1",
    BLOTATO_TEMPLATE_ID_MODE: "path",
    BLOTATO_TEMPLATE_VERIFY: "true",
    BLOTATO_TEMPLATE_AUTO_DISCOVERY: "true",
    BLOTATO_NEWS_TEMPLATE_SEARCH: "AI Video with AI Voice,AI Story Video,AI Voice,Story Video",
    BLOTATO_USE_MANUAL_TEMPLATE_INPUTS: "false",
    BLOTATO_VIDEO_SCENE_COUNT: "7",
    BLOTATO_LOW_COST_IMAGE_MODEL_LABEL: "flux schnell",
    BLOTATO_LOW_COST_VIDEO_MODEL_LABEL: "framepack",
    BLOTATO_MAX_EXPECTED_CREDITS: "70",
    BLOTATO_VIDEO_FINAL_GRACE_MS: "15000",
    BLOTATO_VIDEO_POLL_PROGRESS_EVERY: "30",
    BLOTATO_NEWS_JSON_RESPONSE_FORMAT: "true",
    BLOTATO_API_RETRY_ATTEMPTS: "3",
    BLOTATO_API_RETRY_BASE_MS: "1000",
    BLOTATO_API_RETRY_MAX_MS: "12000",
    BLOTATO_REQUIRE_ALL_CHANNELS: "false",
    BLOTATO_TIKTOK_PRIVACY_LEVEL: "PUBLIC_TO_EVERYONE",
    BLOTATO_TIKTOK_DISABLED_COMMENTS: "false",
    BLOTATO_TIKTOK_DISABLED_DUET: "false",
    BLOTATO_TIKTOK_DISABLED_STITCH: "false",
    BLOTATO_TIKTOK_IS_BRANDED_CONTENT: "false",
    BLOTATO_TIKTOK_IS_YOUR_BRAND: "false",
    BLOTATO_TIKTOK_IS_AI_GENERATED: "true",
    BLOTATO_VIDEO_POLL_ATTEMPTS: "720",
    BLOTATO_VIDEO_POLL_INTERVAL_MS: "5000",
    BLOTATO_POST_POLL_ATTEMPTS: "120",
    BLOTATO_POST_POLL_INTERVAL_MS: "3000",
    BLOTATO_INSTAGRAM_ACCOUNT_ID: "48812",
    BLOTATO_YOUTUBE_ACCOUNT_ID: "37622",
    BLOTATO_API_KEY: "{{ secret.BLOTATO_API_KEY }}",
    BLOTATO_API_BASE: "https://backend.blotato.com/v2",
    BLOTATO_TIMEOUT_MS: "30000",
    BLOTATO_NEWS_SHORT_MAX_TOKENS: "2200",
    BLOTATO_NEWS_RSS_URL: "https://ai-news.jonathan-harris.online/feed.xml",
    BLOTATO_RSS_PREFER_R2: "true",
    BLOTATO_RSS_BUCKET_ALIAS: "rss",
    BLOTATO_RSS_JSON_KEY: "feed.json",
    BLOTATO_RSS_PICK_MODE: "latest",
  });

  assert.deepEqual(errors, []);
});
