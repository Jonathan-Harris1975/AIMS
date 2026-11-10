import test from "node:test";
import assert from "node:assert/strict";
import { generateHeroImage } from "../services/newsletter/engine/heroImage.js";
import { attachArtworkQaEvidence } from "../services/artwork/utils/artwork.js";
const input = { profile: { id: "ai-edge", storage: { keyPrefix: "newsletter/ai-edge" } },
  heroHeadline: "AI access controls", leadStory: { title: "AI access controls", summary: "A review of access to AI systems." }, sessionId: "NL-recovery" };
const generated = { ok: true, publicUrl: "https://images.example/fresh.png", key: "fresh.png", bucketKey: "blogImages" };

test("a failed hero image gets a source-grounded corrective render without repeating QA defects", async () => {
  const calls = [];
  const directions = [];
  const result = await generateHeroImage(input, { buildPrompt: async (options) => {
    directions.push(options);
    return options.repairDiagnostics ? "AI access controls: an unmarked hardware key disconnected from a secured workstation." : "An engineer at an access cabinet.";
  },
    createArtwork: async (options) => { calls.push(options); return calls.length === 1
      ? { ok: false, error: "Readable cabinet labels and malformed fingers", fallback: true } : generated; } });
  assert.equal(result.ok, true);
  assert.equal(result.imageStatus, "generated");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].mode, "newsletter");
  assert.equal(directions.length, 2);
  assert.ok(directions[1].repairDiagnostics);
  assert.equal(directions[1].sessionId, "NL-recovery-art-direction-repair");
  assert.doesNotMatch(calls[1].prompt, /An engineer at an access cabinet/);
  assert.equal(calls[1].sessionId, "NL-recovery-artwork-repair");
  assert.match(calls[1].prompt, /AI access controls/);
  assert.doesNotMatch(calls[1].prompt, /Readable cabinet labels and malformed fingers/);
  assert.match(calls[1].prompt, /single plausible physical object/);
  assert.match(calls[1].prompt, /Keep hands out of frame/);
  assert.match(calls[1].prompt, /Do not show screens/);
  assert.equal(result.prompt, calls[1].prompt);
});

test("passing art is kept once; exhausted or diagnostic art cannot authorise publication", async () => {
  let calls = 0;
  const deps = { buildPrompt: async () => "Source-specific photo", createArtwork: async () => { calls++; return generated; } };
  assert.equal((await generateHeroImage(input, deps)).ok, true);
  assert.equal(calls, 1);
  calls = 0;
  deps.createArtwork = async () => { calls++; return { ...generated, fallback: true, imageStatus: "deterministic-fallback" }; };
  assert.equal((await generateHeroImage(input, deps)).ok, false);
  assert.equal(calls, 2);
  calls = 0;
  deps.createArtwork = async () => { calls++; throw new Error("image provider unavailable"); };
  assert.equal((await generateHeroImage(input, deps)).ok, false);
  assert.equal(calls, 2);
});

test("failed visual QA exposes bounded scores and provider identity without defect text", async () => {
  const diagnostic = {
    stage: "visual_qa",
    reasonCodes: ["decorative_geometry", "text_or_pseudotext"],
    scores: { score: 62, threshold: 80, relevance: 55, minRelevance: 70, textSafety: 98, minTextSafety: 90 },
    provider: { id: "primary", model: "openrouter/image-model" },
  };
  const result = await generateHeroImage(input, {
    buildPrompt: async () => "Private story prompt that must not enter diagnostics",
    createArtwork: async () => ({ ok: false, error: "QA said decorative polygons", artworkDiagnostics: diagnostic }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.artworkDiagnostics.stage, "visual_qa");
  assert.equal(result.artworkDiagnostics.attemptCount, 2);
  assert.equal(result.artworkDiagnostics.recoveryAttempted, true);
  assert.equal(result.artworkDiagnostics.attempts[0].scores.score, 62);
  assert.deepEqual(result.artworkDiagnostics.attempts[0].reasonCodes, ["decorative_geometry", "text_or_pseudotext"]);
  assert.deepEqual(result.artworkDiagnostics.attempts[0].provider, { id: "primary", model: "openrouter/image-model" });
  assert.doesNotMatch(JSON.stringify(result.artworkDiagnostics), /Private story prompt|decorative polygons/);
  assert.match(result.error, /did not pass visual QA/);
});

test("provider retry failure retains the last QA scores and provider identity", () => {
  const qa = { score: 61, threshold: 80, hardDefects: ["Decorative geometric wallpaper"], defects: [] };
  const candidate = { qa, provider: { id: "primary", model: "openrouter/image-model" } };
  const failure = attachArtworkQaEvidence(new Error("all image providers rejected"), [candidate]);
  assert.equal(failure.artworkVisualQa, qa);
  assert.equal(failure.artworkCandidate, candidate);
});
