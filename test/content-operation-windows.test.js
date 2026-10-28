import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const opsSource = fs.readFileSync(new URL("../services/ops/index.js", import.meta.url), "utf8");

function occurrences(text, needle) {
  return text.split(needle).length - 1;
}

test("weekday AM windows contain blog-social handoff and both Blotato schedule slots", () => {
  const eveningPaths = {
    monday: "/blotato/shorts/news-insight/schedule",
    tuesday: "/blotato/shorts/model-verdict/schedule",
    wednesday: "/blotato/shorts/ai-at-work/schedule",
    thursday: "/blotato/shorts/reality-check/schedule",
    friday: "/blotato/shorts/ai-playbook/schedule",
  };
  for (const day of Object.keys(eveningPaths)) {
    const start = opsSource.indexOf(`"${day}-am": [`);
    const next = opsSource.indexOf("  ],", start);
    const block = opsSource.slice(start, next);
    assert.equal(occurrences(block, '/blog/social/daily/build'), 1, `${day} must build one social-blog item`);
    assert.equal(occurrences(block, '/zernio/blog-rss/daily'), 1, `${day} must schedule one social-blog item`);
    assert.equal(occurrences(block, `/zernio/daily/${day}`), 1, `${day} must schedule one daily evergreen item`);
    assert.equal(occurrences(block, '/blotato/autoshorts/schedule'), 1, `${day} must have one Blotato AM slot`);
    assert.equal(occurrences(block, eveningPaths[day]), 1, `${day} must have one Blotato PM slot`);
    const socialLines = block.split(/\r?\n/).filter((line) => /\["(?:blotato-(?:am|pm)|zernio-(?:monday|tuesday|wednesday|thursday|friday))"/.test(line));
    assert.ok(socialLines.length >= 3, `${day} must expose the independent provider tasks`);
    for (const line of socialLines) {
      assert.equal(line.includes('"rss-rewrite"'), false, `${day} provider task must not depend on RSS rewrite`);
      assert.equal(line.includes('"blotato-am"],'), false, `${day} PM provider task must not depend on AM success`);
    }
  }
});

test("Friday AM prepares weekend Zernio and Friday PM is podcast only", () => {
  const fridayAm = opsSource.slice(opsSource.indexOf('"friday-am": ['), opsSource.indexOf('"friday-pm": ['));
  assert.ok(fridayAm.includes('/zernio/daily/saturday'));
  assert.ok(fridayAm.includes('/zernio/daily/sunday'));
  const fridayPm = opsSource.slice(opsSource.indexOf('"friday-pm": ['), opsSource.indexOf('});', opsSource.indexOf('"friday-pm": [')));
  assert.ok(fridayPm.includes('/podcast/run'));
  assert.equal(fridayPm.includes('/blotato/'), false);
  assert.equal(fridayPm.includes('/zernio/'), false);
});

test("weekday newsletter build is independent and delivery waits for readiness", () => {
  for (const day of ["monday", "tuesday", "wednesday", "thursday", "friday"]) {
    const start = opsSource.indexOf(`"${day}-am": [`);
    const end = opsSource.indexOf("  ],", start);
    const lines = opsSource.slice(start, end).split(/\r?\n/).filter((line) => line.includes('"newsletter-'));
    assert.equal(lines.length, 3, `${day} must have one build, readiness and send`);
    assert.match(lines[0], /"newsletter-generate".*"newsletter"\],/);
    assert.match(lines[1], /"newsletter-readiness".*"newsletter-generate"/);
    assert.match(lines[2], /"newsletter-send".*"newsletter-readiness"/);
  }
});

test("weekly website blog, e-books and quiz retain their separate owners", () => {
  const start = opsSource.indexOf('const OPERATION_WINDOWS = Object.freeze({');
  const end = opsSource.indexOf('\n});', start);
  const windows = opsSource.slice(start, end);
  assert.equal(occurrences(windows, '"/blog/weekly/build"'), 1);
  assert.equal(occurrences(windows, '"/zernio/ebooks/weekly"'), 1);
  assert.equal(occurrences(windows, '"/zernio/quiz/weekly"'), 1);
  const routes = fs.readFileSync(new URL('../services/zernio/routes/social.js', import.meta.url), 'utf8');
  assert.ok(routes.includes('runner: buildAndScheduleBlogRssDaily'));
  assert.equal(routes.includes('blog-rss-repost-retired'), false);
});


test("production keeps six weekday windows and prepares weekend evergreen posts on Friday", () => {
  const start = opsSource.indexOf('const OPERATION_WINDOWS = Object.freeze({');
  const end = opsSource.indexOf('\n});', start);
  const windows = opsSource.slice(start, end);
  assert.deepEqual([...windows.matchAll(/^  "([a-z]+-(?:am|pm))": \[/gm)].map((match) => match[1]),
    ["monday-am", "tuesday-am", "wednesday-am", "thursday-am", "friday-am", "friday-pm"]);
  const friday = windows.slice(windows.indexOf('"friday-am": ['), windows.indexOf('"friday-pm": ['));
  assert.equal(occurrences(friday, '/zernio/daily/saturday'), 1);
  assert.equal(occurrences(friday, '/zernio/daily/sunday'), 1);
});
