import test from "node:test";
import assert from "node:assert/strict";

import { runBlotatoShortGate } from "../services/blotato/utils/shortGate.js";
import { repairShortPackForBlotatoGate } from "../services/blotato/utils/newsShortsService.js";

function longScript() {
  return [
    "Claude makes SVG illustrations from prompts.",
    "The useful question is not whether the demo looks tidy.",
    "It is whether a working team can place the output into a reliable design workflow.",
    "The risk sits in review, rights, consistency and the human approval step.",
    "Treat the feature as a draft accelerator, not a finished design department.",
    "Start with one repeatable visual task, test the output against brand rules, then decide whether it saves time without creating cleanup work.",
    "For straight-talking artificial intelligence analysis, keep Jonathan Harris on your radar.",
  ].join(" ");
}

function weakModelVerdictPack() {
  const visualBase = "Human-centred dark editorial AI workspace with an adult analyst, expressive face, hands on laptop, over-shoulder review and no readable text";
  return {
    lane: "model-verdict",
    internalTitle: "Claude makes SVG illustrations",
    angle: "A practical verdict on Claude SVG generation for real design workflows.",
    hook: "Claude makes SVG illustrations.",
    script: longScript(),
    visualDirection: visualBase,
    thumbnailText: "Claude Images",
    youtubeTitle: "Claude SVG illustrations verdict",
    youtubeDescription: "A practical artificial intelligence verdict. #ArtificialIntelligence #AINews #Claude",
    tiktokCaption: "A practical AI verdict. #ArtificialIntelligence #AINews #Claude",
    instagramCaption: "A practical AI verdict. #ArtificialIntelligence #AINews #Claude",
    facebookCaption: "A practical AI verdict from Jonathan Harris.",
    qualityNotes: "Weak hook fixture for quality repair testing.",
    scenes: Array.from({ length: 4 }, (_, index) => ({
      mediaSource: `${visualBase}, scene ${index + 1}, premium phone-first composition, no labels or typography.`,
      script: [
        "Claude makes SVG illustrations from prompts, but the useful question is workflow fit.",
        "A working team still needs review, rights checks, consistency checks and a human approval step.",
      ].join(" "),
    })),
  };
}

test("Blotato quality repair strengthens a weak model-verdict hook before rendering", () => {
  process.env.BLOTATO_NEWS_MIN_SCRIPT_WORDS = "95";
  process.env.BLOTATO_NEWS_MIN_SCENE_WORDS = "90";
  process.env.BLOTATO_HUMAN_VISUALS_ENABLED = "true";
  process.env.BLOTATO_HUMAN_VISUAL_MIN_SCENES = "3";

  const article = {
    title: "Claude makes SVG illustrations from prompts",
    summary: "Anthropic's assistant can generate SVG images, but teams still need review before using them in real workflows.",
    source: "AI news feed",
  };
  const original = weakModelVerdictPack();
  const originalGate = runBlotatoShortGate({ pack: original, article, lane: "model-verdict" });

  assert.equal(originalGate.ok, false);
  assert.match(originalGate.defects.join("\n"), /Hook performance score too low/);

  const repaired = repairShortPackForBlotatoGate(original, {
    article,
    lane: "model-verdict",
    gate: originalGate,
  });
  const repairedGate = runBlotatoShortGate({ pack: repaired, article, lane: "model-verdict" });

  assert.equal(repairedGate.ok, true);
  assert.ok(repairedGate.performance.hookScore >= 55);
  assert.match(repaired.hook, /Claude/i);
  assert.match(repaired.hook, /but|risk/i);
  assert.match(repaired.hook, /your workflow/i);
  assert.ok(repaired.scenes.filter((scene) => /adult|human|hands|face|shoulder|professional/i.test(scene.mediaSource)).length >= 3);
});
