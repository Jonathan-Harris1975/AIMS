import test from "node:test";
import assert from "node:assert/strict";
import { selectDailySocialSources } from "../services/blog/social/buildDailySocialBlogPost.js";

test("other channels covering every fresh source cannot silently suppress the daily blog", () => {
  const sources = [{ link: "https://news.example/today-a" }, { link: "https://news.example/today-b" }];
  assert.deepEqual(selectDailySocialSources(sources, () => true), sources);
  assert.deepEqual(selectDailySocialSources(sources, item => item === sources[0]), [sources[1]]);
  assert.deepEqual(selectDailySocialSources([], () => true), []);
});
