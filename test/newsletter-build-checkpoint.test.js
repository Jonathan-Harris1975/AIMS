import test from "node:test";
import assert from "node:assert/strict";
import { readEditorialCheckpoint, writeEditorialCheckpoint } from "../services/newsletter/engine/buildCheckpoint.js";

const profile = { id: "checkpoint-test", brandVoice: "British English" };
const now = new Date("2026-10-29T10:00:00Z");
function context() {
  const sources = Array.from({ length: 6 }, (_, i) => ({ title: `Story ${i}`, link: `https://news.example/${i}` }));
  const newsletter = {
    subject: "Today's AI briefing", heroHeadline: "Practical AI", openingNoteHtml: "<p>Today's developments.</p>",
    bigThree: sources.slice(0, 3).map((s) => ({ ...s, whatHappened: "A release.", whyItMatters: "Useful.", jonathanTake: "Test it." })),
    worthUsing: { ...sources[3], summary: "An update.", whyUseful: "Useful." },
    onRadar: sources.slice(4).map((s) => ({ ...s, summary: "An update." })),
    realityCheck: { claim: "A claim.", assessment: "Check the evidence.", link: sources[0].link }, yourTurn: "What have you tested?",
  };
  return { profile, now, sessionId: "NL-original-issue", lead: sources[0], stories: sources.slice(1), promotion: null, droppedForDiversity: [],
    qaResult: { ok: true, quarantined: false, finalScore: 95, newsletter } };
}

test("approved editorial work survives process restart and later-stage retry on the same day", async () => {
  const objects = new Map();
  const write = async (bucket, key, value) => { assert.equal(bucket, "metasystem"); objects.set(key, JSON.stringify(value)); };
  const read = async (bucket, key) => { assert.equal(bucket, "metasystem"); return objects.get(key); };
  const original = context();
  assert.equal(await writeEditorialCheckpoint(original, write), true);
  const resumed = await readEditorialCheckpoint({ profile, now: new Date("2026-10-29T12:00:00Z") }, read);
  assert.deepEqual(resumed.qaResult, original.qaResult);
  assert.equal(resumed.sessionId, "NL-original-issue");
  assert.deepEqual(resumed.stories, original.stories);
  original.heroImageResult = { ok: true, imageStatus: "generated", imageUrl: "https://images.example/hero.png" };
  await writeEditorialCheckpoint(original, write);
  assert.deepEqual((await readEditorialCheckpoint({ profile, now }, read)).heroImageResult, original.heroImageResult);
  assert.equal(await readEditorialCheckpoint({ profile, now: new Date("2026-10-30T10:00:00Z") }, read), null);
  assert.equal(await readEditorialCheckpoint({ profile: { ...profile, brandVoice: "Changed policy" }, now }, read), null);
});

test("quarantined or invalid drafts never become checkpoint approvals", async () => {
  let writes = 0;
  const write = async () => { writes += 1; };
  const failed = context(); failed.qaResult.ok = false; failed.qaResult.quarantined = true;
  assert.equal(await writeEditorialCheckpoint(failed, write), false);
  const invalid = context(); invalid.qaResult.newsletter.subject = "";
  assert.equal(await writeEditorialCheckpoint(invalid, write), false);
  assert.equal(writes, 0);
});

test("corrupt/unavailable checkpoints fall back to the normal build rather than an approval", async () => {
  assert.equal(await readEditorialCheckpoint({ profile, now }, async () => "{"), null);
  assert.equal(await readEditorialCheckpoint({ profile, now }, async () => { throw new Error("offline"); }), null);
  assert.equal(await writeEditorialCheckpoint(context(), async () => { throw new Error("offline"); }), false);
});
