import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const opsSource = fs.readFileSync(new URL("../services/ops/index.js", import.meta.url), "utf8");
const zernioRoutes = fs.readFileSync(new URL("../services/zernio/routes/social.js", import.meta.url), "utf8");
const blogSocial = fs.readFileSync(new URL("../services/blog/social/buildDailySocialBlogPost.js", import.meta.url), "utf8");

test("every weekday AM runs Zernio blog RSS immediately after Blog Social build", () => {
  for (const day of ["monday", "tuesday", "wednesday", "thursday", "friday"]) {
    const start = opsSource.indexOf(`"${day}-am": [`);
    assert.notEqual(start, -1, `${day}-am window missing`);
    const nextName = day === "friday" ? "friday-pm" : `${({monday:"tuesday",tuesday:"wednesday",wednesday:"thursday",thursday:"friday"}[day])}-am`;
    const nextWindow = opsSource.indexOf(`"${nextName}": [`, start + 1);
    const block = opsSource.slice(start, nextWindow);
    const build = block.indexOf('"/blog/social/daily/build"');
    const publish = block.indexOf('"/zernio/blog-rss/daily"');
    assert.ok(build >= 0, `${day}-am Blog Social build missing`);
    assert.ok(publish > build, `${day}-am Zernio Blog Social missing or before build`);
  }
});

test("weekly content services remain wired to their owning windows", () => {
  assert.match(opsSource, /"zernio-ebooks", "\/zernio\/ebooks\/weekly"/);
  assert.match(opsSource, /"zernio-quiz", "\/zernio\/quiz\/weekly"/);
  assert.match(opsSource, /"zernio-thursday", "\/zernio\/daily\/thursday"/);
  assert.match(opsSource, /"zernio-saturday", "\/zernio\/daily\/saturday"/);
  assert.match(opsSource, /"zernio-sunday", "\/zernio\/daily\/sunday"/);
  assert.match(opsSource, /"friday-pm": \[\["podcast", "\/podcast\/run", \{\}\]\]/);
});

test("weekday PM Blotato work is prepared in AM and Friday PM is podcast only", () => {
  for (const path of [
    "/blotato/shorts/news-insight/schedule",
    "/blotato/shorts/model-verdict/schedule",
    "/blotato/shorts/ai-at-work/schedule",
    "/blotato/shorts/reality-check/schedule",
    "/blotato/shorts/ai-playbook/schedule",
  ]) assert.match(opsSource, new RegExp(path.replaceAll("/", "\\/")));
  for (const day of ["monday", "tuesday", "wednesday", "thursday"]) {
    assert.doesNotMatch(opsSource, new RegExp(`"${day}-pm"`));
  }
});

test("ebook route validates the actual request body", () => {
  assert.match(zernioRoutes, /validateBody\(zernioEbookWeeklyBodySchema, req\.body\)/);
  assert.doesNotMatch(zernioRoutes, /validateBody\(zernioEbookWeeklyBodySchema,\s*zernioPodcastPromoBodySchema/);
});

test("Blog Social does not trigger a website rebuild", () => {
  assert.match(blogSocial, /blog-social-r2-rss-does-not-require-website-rebuild/);
  assert.doesNotMatch(blogSocial, /const rebuild = await triggerWebsiteRebuild\(\)/);
});
