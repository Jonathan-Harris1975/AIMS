import test from "node:test";
import assert from "node:assert/strict";
import {
  assessRenderedVideoQaPublication,
  buildRenderedVideoQaPrompt,
  evaluateRenderedVideoTechnical,
  normaliseRenderedVideoQa,
  renderedVideoSampleTimes,
} from "../services/blotato/utils/renderedVideoQa.js";

test("the observed 40.87 second vertical render passes technical duration QA", () => {
  const result = evaluateRenderedVideoTechnical({
    durationSeconds: 40.866667,
    width: 1080,
    height: 1920,
    fps: 30,
  });
  assert.equal(result.pass, true);
  assert.equal(result.aspectRatio, 0.5625);
});

test("finished-video visual QA fails an off-topic 36 score", () => {
  const result = normaliseRenderedVideoQa({
    score: 36,
    hookPerformance: 7,
    sourceRelevance: 20,
    sceneAlignment: 30,
    continuity: 60,
    visualProgression: 25,
    visualQuality: 55,
    captionLegibility: 80,
    defects: ["Repeated generic desk scenes"],
    hardDefects: ["Visuals do not depict the construction safety source"],
    summary: "Polished but off-topic",
    recommendation: "Regenerate around the real site",
  }, { technical: { pass: true } });
  assert.equal(result.pass, false);
  assert.equal(result.score, 36);
  assert.equal(result.hookPerformance, 7);
  assert.deepEqual(assessRenderedVideoQaPublication(result), {
    block: true,
    hardFailure: true,
    softFailure: false,
  });
});

test("finished-video performance scores are advisory unless strict mode is enabled", () => {
  const result = normaliseRenderedVideoQa({
    score: 68,
    hookPerformance: 62,
    sourceRelevance: 78,
    sceneAlignment: 72,
    continuity: 76,
    visualProgression: 66,
    visualQuality: 74,
    captionLegibility: 82,
    defects: ["Opening movement could be stronger"],
    hardDefects: [],
    summary: "Relevant and usable, but not a top performance score",
    recommendation: "Strengthen the next opening",
  }, { technical: { pass: true } });

  assert.equal(result.pass, false);
  assert.deepEqual(assessRenderedVideoQaPublication(result), {
    block: false,
    hardFailure: false,
    softFailure: true,
  });
  assert.equal(assessRenderedVideoQaPublication(result, { blockSoftFailures: true }).block, true);
});

test("rendered-video prompt explicitly penalises generic metaphor props", () => {
  const prompt = buildRenderedVideoQaPrompt({
    article: { title: "Construction safety", summary: "AI cameras on a building site" },
    pack: { hook: "Safety cameras change the site", script: "A complete script", scenes: [] },
    technical: { durationSeconds: 40 },
  });
  assert.match(prompt, /cards\/board games\/miniatures/i);
  assert.match(prompt, /post-render quality control/i);
  assert.match(prompt, /hookPerformance/i);
  assert.match(prompt, /technically polished but off-topic/i);
});


test("finished-video contact sheet oversamples the first three seconds", () => {
  const times = renderedVideoSampleTimes(40.866667, 8);
  assert.deepEqual(times.slice(0, 3), [0.25, 1.15, 2.65]);
  assert.ok(times.at(-1) > 39);
});
