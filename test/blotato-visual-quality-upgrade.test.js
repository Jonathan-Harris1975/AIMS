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
  const escalated = resolveImageProviderPlan({
    providers,
    primary: "route/primary",
    qualityTier: "route/quality",
    escalationEnabled: true,
    maxAttempts: 3,
  });
  assert.deepEqual(escalated.models, ["route/primary", "route/quality", "route/backup"]);
  const independentlyCredentialed = resolveImageProviderPlan({ providers: [
    { model: "route/primary", id: "p-key-a" },
    { model: "route/primary", id: "p-key-b" },
    { model: "route/backup", id: "b-key-a" },
  ], maxAttempts: 2 });
  assert.deepEqual(independentlyCredentialed.providers.map((provider) => provider.id), ["p-key-a", "p-key-b", "b-key-a"]);
  const existingOnly = resolveImageProviderPlan({ providers, strategy: "existing-only" });
  assert.deepEqual(existingOnly.models, ["route/primary"]);

  const qualityAsFallbackWhenEscalationIsCapped = resolveImageProviderPlan({
    providers: [providers[0], providers[1]],
    primary: "route/primary",
    qualityTier: "route/quality",
    strategy: "existing-first",
    escalationEnabled: true,
    maxEscalations: 0,
  });
  assert.deepEqual(qualityAsFallbackWhenEscalationIsCapped.models, ["route/primary", "route/quality"]);
  const qualityFirstRetainsDistinctBackup = resolveImageProviderPlan({
    providers,
    primary: "route/primary",
    qualityTier: "route/quality",
    strategy: "quality-first",
    maxAttempts: 3,
  });
  assert.deepEqual(qualityFirstRetainsDistinctBackup.models, ["route/quality", "route/primary", "route/backup"]);
  const nullEscalationLimitUsesDefault = resolveImageProviderPlan({
    providers,
    primary: "route/primary",
    qualityTier: "route/quality",
    escalationEnabled: true,
    maxEscalations: null,
    maxAttempts: 3,
  });
  assert.deepEqual(nullEscalationLimitUsesDefault.models, ["route/primary", "route/quality", "route/backup"]);
  assert.throws(() => resolveImageProviderPlan({ providers, fallback: "unapproved/model" }), /central artwork route/);
  assert.throws(() => resolveImageProviderPlan({ providers: [] }), /No centrally configured image models/);
});

test("image score weights are calibrated to the requested 100-point framework", () => {
  assert.equal(imageQualityScore({ relevance: 100, visualQuality: 100, composition: 100, brand: 100, originality: 100, platform: 100, technical: 100 }).score, 100);
});

test("quality-first routing never falls back when fallback is disabled", () => {
  const providers = [{ model: "route/primary" }, { model: "route/quality" }, { model: "route/backup" }];
  const plan = resolveImageProviderPlan({ providers, qualityTier: "route/quality", strategy: "quality-first", fallbackEnabled: false });
  assert.deepEqual(plan.models, ["route/quality"]);
  assert.equal(plan.fallbackEnabled, false);
});

test("creative brief and video theme registry agree on content and recent history", async () => {
  const { selectBlotatoVisualTheme } = await import("../services/blotato/utils/blotatoVisualThemes.js");
  const topic = "AI inference infrastructure news";
  const recentThemes = ["futuristic", "futuristic", "futuristic", "modern"];
  const expected = selectBlotatoVisualTheme({ topic, history: [...recentThemes].reverse() });
  assert.equal(selectBlotatoTheme({ topic, recentThemes }).theme, expected.key);
  assert.equal(buildCreativeBrief({ topic, recentThemes }).version, expected.version);
});

test("image QA rejects malformed or inflated dimension evidence", () => {
  const good = { relevance: 100, visualQuality: 100, composition: 100, brand: 100, originality: 100, platform: 100, technical: 100 };
  for (const relevance of [101, -1, NaN, Infinity, "100"]) {
    assert.equal(imageQualityScore({ ...good, relevance }).pass, false);
  }
  assert.equal(imageQualityScore({ ...good, criticalDefects: null }).pass, false);
});

test("visual request preserves factual constraints with a separate directive", async () => {
  const { buildVisualCreationRequest } = await import("../services/blotato/utils/visualRequest.js");
  const request = buildVisualCreationRequest({
    candidateTemplateId: "template", visualPrompt: "Story", manualInputsConfigured: false,
    creativeBrief: { theme: "modern", factualConstraints: "Source only", subjectPlacement: "Centre" },
   });
  assert.ok(request.prompt.startsWith("Story\n\nCREATIVE BRIEF:"));
  assert.match(request.prompt, /factual-constraints=Source only/);
});

test("historical acceptance cannot replay a render with hard QA defects", async () => {
  const { isRetryableRenderedPublishFailure } = await import("../services/blotato/utils/autoPublishService.js");
  const job = { status: "failed", phase: "publish-failed", videoId: "paid-render", attempt: 1 };
  for (const qa of [{ hardDefects: ["off-topic"] }, { technical: { pass: false } }, { skipped: true }]) {
    assert.equal(isRetryableRenderedPublishFailure({ ...job, renderedVideoQa: { acceptedForScheduling: true, ...qa } }), false);
  }
});

test("storyboard retains supplied source and weights planned duration by narration", () => {
  const storyboard = buildStoryboard({
    article: { url: "https://example.com/source" }, durationSeconds: 40,
    scenes: [{ script: "One", onScreenText: "Title" }, { script: "Two three four" }],
  });
  assert.deepEqual(storyboard[0].factualSources, ["https://example.com/source"]);
  assert.equal(storyboard[0].onScreenText, "Title");
  assert.equal(storyboard[0].endSeconds, 10);
  assert.equal(storyboard[1].endSeconds, 40);
});

test("audio signal QA rejects inaudibility, excessive silence and missing evidence", async () => {
  const { evaluateAudioSignal } = await import("../services/blotato/utils/renderedVideoQa.js");
  const audible = "mean_volume: -20.0 dB\nmax_volume: -3.0 dB";
  assert.equal(evaluateAudioSignal(audible, 40).pass, true);
  assert.equal(evaluateAudioSignal(audible + "\nsilence_duration: 30", 40).pass, false);
  assert.equal(evaluateAudioSignal("mean_volume: -91.0 dB\nmax_volume: -91.0 dB", 40).pass, false);
  assert.equal(evaluateAudioSignal("", 40).pass, false);
});
