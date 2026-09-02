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
    const next = day === "friday" ? opsSource.indexOf('"friday-pm": [', start) : opsSource.indexOf(`"${({monday:"tuesday",tuesday:"wednesday",wednesday:"thursday",thursday:"friday"})[day]}-am": [`, start);
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
