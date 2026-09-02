import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("social publishing contract is current-day, personal-brand and recovers missed slots", async () => {
  const socialBlog = await readFile(new URL("../services/blog/social/buildDailySocialBlogPost.js", import.meta.url), "utf8");
  const socialPackage = await readFile(new URL("../services/blog/utils/socialBlogPackage.js", import.meta.url), "utf8");
  const zernio = await readFile(new URL("../services/zernio/utils/socialScheduler.js", import.meta.url), "utf8");
  const blotato = await readFile(new URL("../services/blotato/utils/autoPublishService.js", import.meta.url), "utf8");
  const env = await readFile(new URL("../config/production.defaults.env", import.meta.url), "utf8");

  assert.match(socialBlog, /const dateId = formatIsoDate\(end\)/);
  assert.doesNotMatch(socialBlog, /const dateId = formatIsoDate\(new Date\(end\.getTime\(\) - MS_PER_DAY\)\)/);
  assert.match(socialPackage, /independent personal-brand editorial/);
  assert.match(socialPackage, /never an enterprise campaign, consultancy deck, SaaS advert or corporate brand asset/);
  assert.match(zernio, /independent professional AI author\/host publication/);
  assert.match(zernio, /zernio-schedule-slot-missed/);
  assert.match(blotato, /blotato-schedule-slot-missed/);
  assert.match(blotato, /No paid render was started|no paid render was started/i);
  assert.match(env, /^ZERNIO_SCHEDULE_RECOVERY_ENABLED=true$/m);
  assert.match(env, /^BLOTATO_SCHEDULE_RECOVERY_ENABLED=true$/m);
});
