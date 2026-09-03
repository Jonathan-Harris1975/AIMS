import test from "node:test";
import assert from "node:assert/strict";
import { selectPublishableSocialArtworkCandidate } from "../services/artwork/utils/artwork.js";

const observedPrimary = {
  base64: "primary-generated-image",
  provider: { id: "image", model: "bytedance-seed/seedream-4.5" },
  qa: {
    pass: false,
    score: 62,
    threshold: 72,
    relevance: 72,
    textSafety: 72,
    composition: 60,
    brandFit: 65,
    defects: ["Soft composition concern"],
    hardDefects: [],
  },
};

const observedBackup = {
  base64: "backup-generated-image",
  provider: { id: "backup", model: "black-forest-labs/flux.2-pro" },
  qa: {
    pass: false,
    score: 62,
    threshold: 72,
    relevance: 72,
    textSafety: 78,
    composition: 55,
    brandFit: 65,
    defects: ["Soft physical-coherence concern"],
    hardDefects: [],
  },
};

test("Zernio uses the best generated image from the observed soft-QA results instead of a static fallback", () => {
  const selected = selectPublishableSocialArtworkCandidate([observedPrimary, observedBackup], {
    enabled: true,
    floors: { minScore: 55, minRelevance: 60, minTextSafety: 60 },
  });

  assert.equal(selected?.base64, "primary-generated-image");
  assert.equal(selected?.provider?.id, "image");
  assert.deepEqual(selected?.qa?.hardDefects, []);
});

test("Zernio never soft-accepts generated artwork with a hard pixel defect", () => {
  const selected = selectPublishableSocialArtworkCandidate([
    {
      ...observedPrimary,
      qa: {
        ...observedPrimary.qa,
        score: 95,
        textSafety: 98,
        hardDefects: ["Prominent readable generated text"],
      },
    },
  ], { enabled: true, floors: { minScore: 55, minRelevance: 60, minTextSafety: 60 } });

  assert.equal(selected, null);
});

test("Zernio still rejects an off-topic or unsafe soft candidate below the advisory floors", () => {
  const selected = selectPublishableSocialArtworkCandidate([
    {
      ...observedPrimary,
      qa: { ...observedPrimary.qa, score: 40, relevance: 30, textSafety: 45 },
    },
  ], { enabled: true, floors: { minScore: 55, minRelevance: 60, minTextSafety: 60 } });

  assert.equal(selected, null);
});
