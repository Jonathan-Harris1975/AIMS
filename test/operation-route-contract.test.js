import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

function source(path) {
  return fs.readFileSync(new URL(path, import.meta.url), "utf8");
}

const registry = source("../routes/index.js");
const rss = source("../services/rss-feed-creator/routes/rewrite.js");
const outreach = source("../services/outreach/routes/index.js");
const blogIndex = source("../services/blog/routes/index.js");
const blogWeekly = source("../services/blog/routes/weekly.js");
const blogSocial = source("../services/blog/routes/social.js");
const newsletterGenerate = source("../services/newsletter/routes/generate.js");
const newsletterSend = source("../services/newsletter/routes/send.js");
const zernio = source("../services/zernio/routes/social.js");
const blotato = source("../services/blotato/routes/index.js");
const podcast = source("../services/podcast/index.js");
const ops = source("../services/ops/index.js");

test("all operation-window service roots are mounted behind AIMS authentication", () => {
  for (const root of ["/rss", "/outreach", "/blog", "/newsletter", "/zernio", "/blotato", "/podcast", "/ops"]) {
    assert.ok(registry.includes(`path: "${root}"`), `missing mounted root ${root}`);
  }
  assert.match(registry, /router\.use\(requireAimsBearerAuth\)/);
});

test("all weekday morning endpoints exist in their mounted service routers", () => {
  assert.match(rss, /router\.post\("\/rewrite"/);
  assert.match(outreach, /router\.post\("\/batch\/next"/);
  assert.match(blogIndex, /router\.use\("\/weekly"/);
  assert.match(blogIndex, /router\.use\("\/social"/);
  assert.match(blogWeekly, /router\.post\("\/build"/);
  assert.match(blogSocial, /router\.post\("\/daily\/build"/);
  assert.match(newsletterGenerate, /router\.post\("\/generate"/);
  assert.match(newsletterSend, /router\.post\("\/readiness"/);
  assert.match(newsletterSend, /router\.post\("\/send"/);
  assert.match(zernio, /`\/daily\/\$\{laneKey\}`/);
  assert.match(zernio, /"\/blog-rss\/daily"/);
  assert.match(zernio, /"\/ebooks\/weekly"/);
  assert.match(zernio, /"\/quiz\/weekly"/);
  assert.match(blotato, /"\/autoshorts\/schedule"/);
  assert.match(blotato, /"\/shorts\/:lane\/schedule"/);
});

test("Friday podcast and operation status endpoints exist", () => {
  assert.match(podcast, /router\.post\("\/readiness"/);
  assert.match(podcast, /router\.post\("\/run"/);
  assert.match(podcast, /router\.get\("\/status\/:sessionId"/);
  assert.match(ops, /router\.post\("\/run\/:window"/);
  assert.match(ops, /router\.get\("\/jobs\/:id"/);
});
