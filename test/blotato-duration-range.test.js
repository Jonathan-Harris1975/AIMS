import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Blotato shorts use a flexible 35-80 second range", async () => {
  const news = await readFile(new URL("../services/blotato/utils/newsShortsService.js", import.meta.url), "utf8");
  const publish = await readFile(new URL("../services/blotato/utils/autoPublishService.js", import.meta.url), "utf8");
  assert.match(news, /const MIN_DURATION_SECONDS = 35/);
  assert.match(news, /const MAX_DURATION_SECONDS = 80/);
  assert.match(news, /const DEFAULT_DURATION_SECONDS = 55/);
  assert.match(publish, /Math\.min\(80, Math\.max\(35/);
});

test("production word-count range supports longer coherent shorts", async () => {
  const env = await readFile(new URL("../config/production.defaults.env", import.meta.url), "utf8");
  assert.match(env, /^BLOTATO_NEWS_DURATION_SECONDS=55$/m);
  assert.match(env, /^BLOTATO_NEWS_MIN_SCRIPT_WORDS=85$/m);
  assert.match(env, /^BLOTATO_NEWS_TARGET_SCRIPT_WORDS=135$/m);
  assert.match(env, /^BLOTATO_NEWS_MAX_SCRIPT_WORDS=190$/m);
});
