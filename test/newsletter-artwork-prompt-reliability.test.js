// This regression suite is deterministic and does not require a live image-provider call.
import test from "node:test";
import assert from "node:assert/strict";
process.env.OPENROUTER_API_KEY = "test-key";
process.env.AI_MODEL_FAST = "test/luna";
const { buildInstruction } = await import("../services/artwork/utils/artwork.js");
import { buildModelAwareArtworkPrompt } from "../services/artwork/utils/artworkModelPrompt.js";
const { buildHeroImagePrompt } = await import("../services/newsletter/engine/heroImage.js");

// Reproduce realistic long directions, including the source-specific action
// near the old wrapper's truncation boundary. Every configured model family
// must see the action rather than only general newsletter instructions.
test("newsletter scene survives model-family truncation and carries text-resistant staging", () => {
  const direction = "A security engineer disconnects a hardware access key from an isolated workstation. " +
    "Quiet laboratory with plain equipment. ".repeat(36) + "A physical shut-off switch isolates the research workload.";
  for (const model of ["bytedance-seed/seedream-4.5", "black-forest-labs/flux.2-pro", "recraft/recraft-v4", "test/image"]) {
    const prompt = buildModelAwareArtworkPrompt({ model, mode: "newsletter", creativeDirection: buildInstruction(direction, "newsletter", "2026-11-10") });
    assert.match(prompt, /disconnects a hardware access key/);
    assert.match(prompt, /physical shut-off switch isolates the research workload/);
    assert.match(prompt, /screens facing away or out of frame/);
    assert.match(prompt, /wide 16:9/);
  }
});

test("newsletter art direction uses only the selected lead and receives bounded recovery reasons", async () => {
  const previousFetch = globalThis.fetch;
  const saved = { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY, AI_MODEL_FAST: process.env.AI_MODEL_FAST };
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.AI_MODEL_FAST = "test/luna";
  let inspected = false;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const context = JSON.parse(request.messages[1].content);
    assert.equal(context.leadStory.title, "AI access controls");
    assert.equal(context.supportingHeadlines, undefined);
    assert.deepEqual(context.recovery.reasonCodes, ["text_or_pseudotext"]);
    assert.match(context.recovery.direction, /different source-supported physical scene/);
    assert.equal(context.recovery.previousVisualDirection, "A generic desk and monitor");
    inspected = true;
    return { ok: true, json: async () => ({ choices: [{ message: { content: "An engineer disconnects an unmarked access key from a workstation, seen from behind." } }] }) };
  };
  try {
    const prompt = await buildHeroImagePrompt({ profile: { id: "ai-edge" }, heroHeadline: "AI access controls",
      leadStory: { title: "AI access controls", summary: "Limiting AI tool permissions." }, bigThree: [{ title: "Unrelated electricity story" }],
      repairDiagnostics: { reasonCodes: ["text_or_pseudotext"] }, previousVisualDirection: "A generic desk and monitor", sessionId: "prompt-recovery" });
    assert.ok(inspected);
    assert.match(prompt, /disconnects an unmarked access key/);
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});


test("newsletter repair keeps the source context and avoids repeating the failed direction", async () => {
  const { generateHeroImage } = await import("../services/newsletter/engine/heroImage.js");
  const seen = [], prompts = [];
  const result = await generateHeroImage({ profile: { id: "test", storage: { keyPrefix: "test" } },
    heroHeadline: "AI quality checking", leadStory: { title: "AI quality checking", summary: "Human checks of tool output" },
    sessionId: "hero-fix" }, {
    buildPrompt: async (args) => { seen.push(args); return seen.length === 1 ? "Generic desk" : "An analyst checks a physical output"; },
    createArtwork: async (args) => {
      prompts.push(args.prompt);
      return prompts.length === 1 ? { ok: false, artworkDiagnostics: { stage: "visual_qa", reasonCodes: ["generic_scene"] } }
        : { ok: true, publicUrl: "https://example.test/new.png", key: "new.png", imageStatus: "generated" };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(seen[1].previousVisualDirection, "Generic desk");
  assert.equal(seen[1].leadStory.title, "AI quality checking");
  assert.match(prompts[1], /distinct, believable source-specific setting and action/);
  assert.doesNotMatch(prompts[1], /close-up of a single plausible physical object/);
});
