import test from "node:test";
import assert from "node:assert/strict";
import { generateHeroImage } from "../services/newsletter/engine/heroImage.js";
const input = { profile: { id: "ai-edge", storage: { keyPrefix: "newsletter/ai-edge" } },
  heroHeadline: "AI access controls", leadStory: { title: "AI access controls", summary: "A review of access to AI systems." }, sessionId: "NL-recovery" };
const generated = { ok: true, publicUrl: "https://images.example/fresh.png", key: "fresh.png", bucketKey: "blogImages" };

test("a failed hero image gets a source-grounded corrective render using its QA defects", async () => {
  const calls = [];
  const result = await generateHeroImage(input, { buildPrompt: async () => "An engineer at an access cabinet.",
    createArtwork: async (options) => { calls.push(options); return calls.length === 1
      ? { ok: false, error: "Readable cabinet labels and malformed fingers", fallback: true } : generated; } });
  assert.equal(result.ok, true);
  assert.equal(result.imageStatus, "generated");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].mode, "newsletter");
  assert.equal(calls[1].sessionId, "NL-recovery-artwork-repair");
  assert.match(calls[1].prompt, /AI access controls/);
  assert.match(calls[1].prompt, /Readable cabinet labels and malformed fingers/);
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
