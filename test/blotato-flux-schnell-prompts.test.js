import test from "node:test";
import assert from "node:assert/strict";

const ORIGINAL_ENV = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
}

test.afterEach(() => {
  restoreEnv();
});

test("Flux Schnell profile rewrites scene prompts as positive visual briefs", async () => {
  process.env.BLOTATO_IMAGE_PROMPT_PROFILE = "flux-schnell";
  const mod = await import(`../services/blotato/utils/newsShortsService.js?flux=${Date.now()}`);
  const { buildBlotatoVideoInputs } = mod;

  const inputs = buildBlotatoVideoInputs({
    lane: "news-insight",
    hook: "The warehouse workflow is changing.",
    script: "A warehouse team is moving from manual picking to AI-assisted routing. The shift looks efficient. The real question is whether the workflow still leaves room for human checks. That is where the operational risk sits. You need the speed and the oversight.",
    visualDirection: "Warehouse fulfilment centre, autonomous picking robots, conveyor lanes, supervisor oversight, cyan and deep navy editorial lighting.",
    visualContinuity: "One warehouse supervisor, the same fulfilment centre, cyan and deep navy editorial lighting, realistic documentary camera language.",
    scenes: [
      {
        mediaSource: "No readable text, no labels, no signage. Warehouse supervisor beside an autonomous picking robot at a conveyor line, practical tension, human-centred newsroom style.",
        script: "A warehouse team is moving from manual picking to AI-assisted routing.",
      },
    ],
  });

  assert.ok(Array.isArray(inputs.scenes));
  assert.ok(inputs.scenes.length >= 1);
  const prompt = inputs.scenes[0].mediaSource;
  assert.match(prompt, /^Vertical 9:16 /);
  assert.match(prompt, /warehouse supervisor/i);
  assert.match(prompt, /autonomous picking robot/i);
  assert.match(prompt, /blank unmarked screens/i);
  assert.doesNotMatch(prompt, /No readable text|Do not|Never|Avoid/i);
});

test("Flux Schnell profile keeps hands out of frame instead of asking for visible hands", async () => {
  process.env.BLOTATO_IMAGE_PROMPT_PROFILE = "flux-schnell";
  const mod = await import(`../services/blotato/utils/newsShortsService.js?flux=${Date.now() + 1}`);
  const { buildBlotatoVideoInputs } = mod;

  const inputs = buildBlotatoVideoInputs({
    lane: "news-insight",
    hook: "Hospitals are using AI screening.",
    script: "Hospitals are using AI screening. The question is how clinicians verify the result. That human checkpoint is the real safeguard.",
    visualDirection: "Hospital imaging suite, clinician oversight, cyan monitor light, calm but tense atmosphere.",
    visualContinuity: "One clinician, one diagnostic room, cyan monitor light and navy shadow, realistic documentary framing.",
    scenes: [
      {
        mediaSource: "Adult hands using a diagnostic console beside an imaging scanner.",
        script: "Hospitals are using AI screening.",
      },
    ],
  });

  const prompt = inputs.scenes[0].mediaSource;
  assert.match(prompt, /shoulders-up framing|arms outside frame|upper body/i);
  assert.doesNotMatch(prompt, /\bhands?\s+(using|holding|typing)\b/i);
});
