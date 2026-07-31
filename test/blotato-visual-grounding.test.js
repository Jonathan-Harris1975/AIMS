import test from "node:test";
import assert from "node:assert/strict";
import { analyseBlotatoVisualPlan } from "../services/blotato/utils/shortGate.js";

const article = {
  title: "Hong Kong construction safety gets an AI upgrade",
  summary: "Construction sites in Hong Kong are using AI cameras to detect missing helmets and unsafe zones before workers are injured.",
};

test("generic metaphor scenes are rejected as poor source grounding", () => {
  const scenes = [
    ["Woman seated at a desk beside a miniature board game city", "AI is changing construction safety."],
    ["Woman seated at a desk moving playing cards", "Hong Kong sites use cameras."],
    ["Woman seated at a desk beside tiny figurines", "The system spots missing helmets."],
    ["Close portrait looking at a wall calendar", "Workers still need oversight."],
    ["Woman seated at a desk with abstract blocks", "Teams must verify alerts."],
  ].map(([mediaSource, script]) => ({ mediaSource, script }));

  const result = analyseBlotatoVisualPlan({ scenes, article });
  assert.equal(result.groundedScenes, 0);
  assert.equal(result.genericMetaphorScenes, 4);
  assert.equal(result.staticPortraitScenes, 5);
  assert.equal(result.visualProgressionScore, 0);
});

test("source-specific construction scenes score strongly", () => {
  const scenes = [
    ["Wide Hong Kong construction site with tower cranes, scaffolding and helmeted workers entering a marked safety zone, supervisor shoulders-up in foreground", "Hong Kong construction sites are testing AI safety cameras."],
    ["Medium shot of site cameras monitoring workers near concrete formwork and moving machinery, supervisor upper body at edge of frame", "The cameras detect missing helmets and dangerous zone crossings."],
    ["Tight shot of a helmeted worker beside a real site camera and excavator boundary as an alert light changes, no screen text", "That matters where one missed warning can become an injury."],
    ["Over-shoulder site safety officer verifying the physical work area and camera placement, hands outside crop", "But the system still needs a human to check context and false alerts."],
    ["Wide closing view of the same Hong Kong site with separated pedestrian route, cranes and supervised crew working safely", "Use AI to spot risk, then keep people responsible for the decision."],
  ].map(([mediaSource, script]) => ({ mediaSource, script }));

  const result = analyseBlotatoVisualPlan({ scenes, article });
  assert.equal(result.groundedScenes, 5);
  assert.equal(result.genericMetaphorScenes, 0);
  assert.ok(result.sceneAlignmentScore >= 90);
  assert.ok(result.visualProgressionScore >= 85);
});
