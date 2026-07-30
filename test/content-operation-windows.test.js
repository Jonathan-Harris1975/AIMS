import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const opsSource = fs.readFileSync(new URL("../services/ops/index.js", import.meta.url), "utf8");

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
    assert.ok(block.includes('/blog/social/daily/build'));
    assert.ok(block.includes('/zernio/blog-rss/daily'));
    assert.ok(block.includes('/blotato/autoshorts/schedule'));
    assert.ok(block.includes(eveningPaths[day]));
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
