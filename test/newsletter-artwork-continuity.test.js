import test from "node:test";
import assert from "node:assert/strict";
import { finishNewsletterBuild } from "../services/newsletter/engine/buildNewsletter.js";

function context() {
  const sources = [0, 1, 2].map(i => ({ title: `Source report ${i}`, link: `https://news.example/${i}` }));
  const newsletter = { subject: "Practical technology briefing", heroHeadline: "Evidence before promises",
    openingNoteHtml: "<p>Three developments worth your attention.</p>",
    bigThree: sources.map(s => ({ ...s, whatHappened: "A sourced release.", whyItMatters: "A useful development.", jonathanTake: "Test the claims." })),
    onRadar: [], worthUsing: null, realityCheck: { claim: "A reported claim.", assessment: "Check the evidence.", link: sources[0].link },
    footer: { text: "AI Edge from Jonathan Harris." } };
  return { profile: { id: "continuity-test", displayName: "AI Edge", storage: { keyPrefix: "newsletter/ai-edge" } },
    sessionId: "NL-continuity", now: new Date("2026-11-09T10:00:00Z"), lead: sources[0], stories: sources.slice(1),
    promotion: null, droppedForDiversity: [], qaResult: { ok: true, quarantined: false, finalScore: 90, newsletter } };
}
function dependencies(generateHero) {
  const stored = [], checkpoints = [];
  return { stored, checkpoints, generateHero, requireHeroImage: false,
    checkpoint: async value => { checkpoints.push(value); },
    storeIssue: async value => { stored.push(value); return { prefix: "approved-issue", htmlUrl: "https://newsletter.example/issue" }; } };
}

test("failed artwork is omitted while approved copy is published in the existing text-first layout", async () => {
  const deps = dependencies(async () => ({ ok: false, imageUrl: "https://images.example/rejected.png", artworkDiagnostics: { stage: "visual_qa" } }));
  const result = await finishNewsletterBuild(context(), deps);
  assert.equal(result.ok, true);
  assert.equal(result.metadata.qa.passed, true);
  assert.equal(result.metadata.heroImageUrl, null);
  assert.equal(result.metadata.heroImageStatus, "editorial-text-only");
  assert.equal(result.metadata.artwork.diagnostics.stage, "visual_qa");
  assert.match(deps.stored[0].emailHtml, /Evidence before promises/);
  assert.doesNotMatch(deps.stored[0].emailHtml, /rejected\.png|<img/);
  assert.equal(deps.stored.length, 1);
  let regenerationCalls = 0;
  const resumed = dependencies(async () => { regenerationCalls++; throw new Error("Must not regenerate artwork during recovery"); });
  const again = await finishNewsletterBuild({ ...context(), heroImageResult: deps.checkpoints[0].heroImageResult }, resumed);
  assert.equal(again.ok, true);
  assert.equal(regenerationCalls, 0);
  assert.equal(again.metadata.heroImageStatus, "editorial-text-only");
});

test("an artwork service exception does not suppress approved editorial content", async () => {
  const deps = dependencies(async () => { throw new Error("Provider unavailable"); });
  const result = await finishNewsletterBuild(context(), deps);
  assert.equal(result.ok, true);
  assert.deepEqual(result.metadata.artwork.diagnostics, {
    stage: "generation_exception", errorName: "Error", message: "Provider unavailable",
  });
  assert.equal(deps.stored.length, 1);
});

test("a strict artwork policy still holds publication without an approved image", async () => {
  const deps = { ...dependencies(async () => ({ ok: false, error: "Visual QA rejected" })), requireHeroImage: true };
  const result = await finishNewsletterBuild(context(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.quarantined, true);
  assert.equal(deps.stored.length, 0);
});

test("text-first publication retains editorial approval and final structural hard gates", async () => {
  const deps = dependencies(async () => ({ ok: false }));
  const held = context(); held.qaResult.ok = false;
  assert.equal((await finishNewsletterBuild(held, deps)).ok, false);
  const malformed = context(); malformed.qaResult.newsletter.bigThree = malformed.qaResult.newsletter.bigThree.slice(0, 1);
  assert.equal((await finishNewsletterBuild(malformed, deps)).ok, false);
  assert.equal(deps.stored.length, 0);
});

test("an approved generated image is kept without changing the normal layout", async () => {
  const deps = dependencies(async () => ({ ok: true, imageStatus: "generated", imageUrl: "https://images.example/approved.png" }));
  const result = await finishNewsletterBuild(context(), deps);
  assert.equal(result.ok, true);
  assert.equal(result.metadata.heroImageStatus, "generated");
  assert.match(deps.stored[0].emailHtml, /approved\.png/);
});
