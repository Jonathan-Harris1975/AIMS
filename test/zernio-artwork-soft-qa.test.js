import test from "node:test";
import assert from "node:assert/strict";
import { artworkQaRegenerationLimit, selectPublishableSocialArtworkCandidate } from "../services/artwork/utils/artwork.js";
import { buildArtworkVisualQaPrompt } from "../services/artwork/utils/artworkVisualQa.js";
import { readFile } from "node:fs/promises";
import { getArtworkProviderAttempts } from "../services/artwork/utils/openrouterImagePayload.js";

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

test("evergreen QA receives one bounded repair despite the zero shared regeneration setting", () => {
  const savedShared = process.env.ARTWORK_VISUAL_QA_MAX_REGENERATIONS;
  const savedSocial = process.env.SOCIAL_ARTWORK_VISUAL_QA_MAX_REGENERATIONS;
  try {
    process.env.ARTWORK_VISUAL_QA_MAX_REGENERATIONS = "0";
    delete process.env.SOCIAL_ARTWORK_VISUAL_QA_MAX_REGENERATIONS;
    assert.equal(artworkQaRegenerationLimit("social"), 1);
    assert.equal(artworkQaRegenerationLimit("blog"), 0);
    process.env.SOCIAL_ARTWORK_VISUAL_QA_MAX_REGENERATIONS = "9";
    assert.equal(artworkQaRegenerationLimit("social"), 2);
    process.env.SOCIAL_ARTWORK_VISUAL_QA_MAX_REGENERATIONS = "0";
    assert.equal(artworkQaRegenerationLimit("social"), 0);
  } finally {
    if (savedShared === undefined) delete process.env.ARTWORK_VISUAL_QA_MAX_REGENERATIONS;
    else process.env.ARTWORK_VISUAL_QA_MAX_REGENERATIONS = savedShared;
    if (savedSocial === undefined) delete process.env.SOCIAL_ARTWORK_VISUAL_QA_MAX_REGENERATIONS;
    else process.env.SOCIAL_ARTWORK_VISUAL_QA_MAX_REGENERATIONS = savedSocial;
  }
});

test("evergreen candidate cannot be merely generic AI or low in text safety", () => {
  const good = selectPublishableSocialArtworkCandidate([observedPrimary], { enabled: true });
  assert.equal(good?.base64, "primary-generated-image");

  const generic = {
    ...observedPrimary,
    qa: { ...observedPrimary.qa, relevance: 65 },
  };
  assert.equal(selectPublishableSocialArtworkCandidate([generic], { enabled: true }), null);

  const textRisk = {
    ...observedPrimary,
    qa: { ...observedPrimary.qa, textSafety: 65 },
  };
  assert.equal(selectPublishableSocialArtworkCandidate([textRisk], { enabled: true }), null);
});

test("evergreen QA assesses the actual post-specific decision and not generic tech wallpaper", () => {
  const prompt = buildArtworkVisualQaPrompt({
    mode: "social",
    creativePrompt: "Topic: quality checks in radiology AI; show a radiologist inspecting a scan.",
  });
  assert.match(prompt, /specific action, sector, contribution or consequence named in the post/);
  assert.match(prompt, /radiologist inspecting a scan/);
});

test("approved image upload is retried without another paid generation and last-resort fallback is audited", async () => {
  const source = await readFile(new URL("../services/artwork/createSocialArtwork.js", import.meta.url), "utf8");
  const defaults = await readFile(new URL("../config/production.defaults.env", import.meta.url), "utf8");
  assert.match(source, /uploadApprovedSocialArtwork\(key, image, safeSession, safeLane\)/);
  assert.match(source, /uploadBuffer\("blogImages", key, image\.buffer, image\.mimeType\)/);
  assert.match(source, /type: "curated_static_fallback"/);
  assert.match(source, /persist: true/);
  assert.match(defaults, /^SOCIAL_ARTWORK_VISUAL_QA_MAX_REGENERATIONS=1$/m);
  assert.match(defaults, /^ZERNIO_ARTWORK_UPLOAD_ATTEMPTS=3$/m);
});

test("evergreen provider retry budget is independent and bounded to transient errors", () => {
  const originalProvider = process.env.ARTWORK_PROVIDER_ATTEMPTS;
  const originalSocial = process.env.SOCIAL_ARTWORK_PROVIDER_ATTEMPTS;
  try {
    process.env.ARTWORK_PROVIDER_ATTEMPTS = "1";
    process.env.SOCIAL_ARTWORK_PROVIDER_ATTEMPTS = "2";
    assert.equal(getArtworkProviderAttempts("social"), 2);
    assert.equal(getArtworkProviderAttempts("blog"), 1);
    process.env.SOCIAL_ARTWORK_PROVIDER_ATTEMPTS = "99";
    assert.equal(getArtworkProviderAttempts("social"), 6);
  } finally {
    if (originalProvider === undefined) delete process.env.ARTWORK_PROVIDER_ATTEMPTS;
    else process.env.ARTWORK_PROVIDER_ATTEMPTS = originalProvider;
    if (originalSocial === undefined) delete process.env.SOCIAL_ARTWORK_PROVIDER_ATTEMPTS;
    else process.env.SOCIAL_ARTWORK_PROVIDER_ATTEMPTS = originalSocial;
  }
});
