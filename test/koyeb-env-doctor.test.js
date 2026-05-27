import test from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { parseEnvLines, validateEnvEntries, validateEnvFile, validateEnvObject } from "../scripts/koyebEnvDoctor.js";

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
    "BLOTATO_NEWS_TEMPLATE_ID=base/v2/ai-story-video/5903fe43-514d-40ee-a060-0d662...\n"
  );
  const errors = validateEnvEntries(entries);

  assert.ok(errors.length >= 1);
  assert.match(errors.map((error) => error.message).join("\n"), /truncated/i);
});


test("koyeb env doctor rejects generic truncated paste values", () => {
  const { entries } = parseEnvLines(
    "PODCAST_RSS_FEED_URL=https://podcast-rss-feeds.jonathan-harris.online/turing-...\n"
  );
  const errors = validateEnvEntries(entries);

  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /truncated value marker/i);
});

test("koyeb env files checked into the repo pass env doctor", async () => {
  const envDir = path.join(process.cwd(), "koyeb-env");
  const files = (await readdir(envDir))
    .filter((file) => /\.(?:txt|env)$/i.test(file))
    .filter((file) => file !== "remove-legacy-conflicts.cli-env.txt");

  assert.ok(files.length > 0, "expected Koyeb env files to be present");

  for (const file of files) {
    const result = await validateEnvFile(path.join(envDir, file));
    assert.deepEqual(result.errors, [], `${file} should pass env doctor`);
  }
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
    BLOTATO_NEWS_TEMPLATE_ID: "base/v2/ai-story-video/5903fe43-514d-40ee-a060-0d6628c5f8fd/v1",
    BLOTATO_VIDEO_POLL_ATTEMPTS: "90",
    BLOTATO_VIDEO_POLL_INTERVAL_MS: "3000",
    BLOTATO_POST_POLL_ATTEMPTS: "60",
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
