import test from "node:test";
import assert from "node:assert/strict";
import { assertApprovedBlotatoTheme, buildCreativeBrief, buildHookCandidates, buildStoryboard, selectBlotatoTheme } from "../services/blotato/utils/creativeDirection.js";
import { chooseImageModel, imageQualityScore, resolveImageProviderPlan, validateImageGovernance } from "../services/blotato/utils/imageQualityGovernance.js";

test("theme selection uses subject and only approved Blotato themes", () => {
  assert.equal(selectBlotatoTheme({ topic: "AI inference infrastructure costs" }).theme, "futuristic");
  assert.equal(selectBlotatoTheme({ topic: "AI workplace productivity" }).theme, "modern");
  assert.throws(() => assertApprovedBlotatoTheme("neon"), /Unsupported Blotato visual theme/);
});

test("creative brief and storyboard are topic-specific and safe-zone aware", () => {
  const brief = buildCreativeBrief({ topic: "AI inference costs", angle: "Compute economics", audience: "operators" });
  assert.equal(brief.theme, "futuristic");
  const storyboard = buildStoryboard({
    hook: "The cost is hidden in the infrastructure.",
    scenes: [{
      script: "The cost is hidden.",
      mediaSource: "Inference servers under load",
    }],
    creativeBrief: brief,
  });
  assert.equal(storyboard[0].theme, "futuristic");
  assert.match(storyboard[0].imagePrompt, /Inference servers/);
});

test("hooks are bounded and scored without extra model calls", () => {
  const candidates = buildHookCandidates({ topic: "AI inference costs", angle: "Compute economics" });
  assert.equal(candidates.length, 3);
  assert.ok(candidates[0].score >= candidates[1].score);
});

test("image governance rejects unauthorised and circular fallbacks", () => {
  assert.throws(() => validateImageGovernance({ model: "bad/model", allowedModels: ["good/model"] }), /Unauthorised/);
  assert.throws(() => validateImageGovernance({ model: "good/model" }), /allowlist/i);
  assert.throws(() => validateImageGovernance({ model: "good/model", fallback: "good/model", allowedModels: ["good/model"] }), /CIRCULAR|differ/);
  assert.equal(chooseImageModel({ primary: "good/model", fallback: "fallback/model", attempt: 2, fallbackEnabled: true, allowedModels: ["good/model", "fallback/model"] }), "fallback/model");
});

test("image-provider plans stay inside the central route and bound fallback attempts", () => {
  const providers = [
    { model: "route/primary", id: "p" },
    { model: "route/quality", id: "q" },
    { model: "route/backup", id: "b" },
  ];
  const standard = resolveImageProviderPlan({ providers, maxAttempts: 2 });
  assert.deepEqual(standard.models, ["route/primary", "route/quality"]);
  const qualityFirst = resolveImageProviderPlan({
    providers, primary: "route/primary", qualityTier: "route/quality", strategy: "quality-first", maxAttempts: 2,
  });
  assert.deepEqual(qualityFirst.models, ["route/quality", "route/primary"]);
  const existingOnly = resolveImageProviderPlan({ providers, strategy: "existing-only" });
  assert.deepEqual(existingOnly.models, ["route/primary"]);
  assert.throws(() => resolveImageProviderPlan({ providers, fallback: "unapproved/model" }), /central artwork route/);
  assert.throws(() => resolveImageProviderPlan({ providers: [] }), /No centrally configured image models/);
});

test("image score weights are calibrated to the requested 100-point framework", () => {
  assert.equal(imageQualityScore({ relevance: 100, visualQuality: 100, composition: 100, brand: 100, originality: 100, platform: 100, technical: 100 }).score, 100);
});
