import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Blotato shorts use the production 35-55 second range", async () => {
  const news = await readFile(new URL("../services/blotato/utils/newsShortsService.js", import.meta.url), "utf8");
  const publish = await readFile(new URL("../services/blotato/utils/autoPublishService.js", import.meta.url), "utf8");
  assert.match(news, /const MIN_DURATION_SECONDS = 35/);
  assert.match(news, /const MAX_DURATION_SECONDS = 55/);
  assert.match(news, /const DEFAULT_DURATION_SECONDS = 45/);
  assert.match(publish, /Math\.min\(55, Math\.max\(35/);
});

test("production word-count range supports coherent 35-55 second shorts", async () => {
  const env = await readFile(new URL("../config/production.defaults.env", import.meta.url), "utf8");
  const news = await readFile(new URL("../services/blotato/utils/newsShortsService.js", import.meta.url), "utf8");
  assert.match(env, /^BLOTATO_NEWS_DURATION_SECONDS=45$/m);
  assert.match(env, /^BLOTATO_NEWS_MIN_SCRIPT_WORDS=80$/m);
  assert.match(env, /^BLOTATO_NEWS_TARGET_SCRIPT_WORDS=92$/m);
  assert.match(env, /^BLOTATO_NEWS_MAX_SCRIPT_WORDS=102$/m);
  assert.match(env, /^BLOTATO_NEWS_MIN_SCENE_WORDS=80$/m);
  assert.match(news, /targetScriptWords = Math\.min\(MAX_SCRIPT_WORDS, Math\.max\(MIN_SCRIPT_WORDS, TARGET_SCRIPT_WORDS\)\)/);
  assert.doesNotMatch(news, /targetDuration \* 2\.5/);
});
