import test from "node:test";
import assert from "node:assert/strict";

process.env.OPENROUTER_API_KEY = "test-key";
process.env.AI_MODEL_IMAGE = "test/primary";
process.env.OPENROUTER_ART = "test/primary";
process.env.OPENROUTER_ART_BACKUP = "test/backup";
process.env.AI_MODEL_HIGH_QUALITY = "test/reviewer";
process.env.ARTWORK_CAPABILITY_DISCOVERY_ENABLED = "false";
process.env.SOCIAL_ARTWORK_VISUAL_QA_MAX_REGENERATIONS = "0";
process.env.ARTWORK_PROVIDER_ATTEMPTS = "1";
process.env.SOCIAL_ARTWORK_PROVIDER_ATTEMPTS = "1";

test("second image provider uses pixel feedback while review remains anchored to the original story", async () => {
  const originalFetch = globalThis.fetch;
  const imageRequests = [];
  const reviewBriefs = [];
  let reviewCount = 0;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (String(url).endsWith("/images")) {
      imageRequests.push(body);
      return { ok: true, json: async () => ({ data: [{ b64_json: Buffer.from(`image-${imageRequests.length}`).toString("base64") }] }) };
    }
    reviewBriefs.push(body.messages[0].content[0].text);
    reviewCount += 1;
    const qa = reviewCount === 1
      ? { score: 40, relevance: 40, textSafety: 50, composition: 60, brandFit: 60,
        defects: ["Scanner scene misses the planning application"], hardDefects: ["Prominent invented text"], summary: "Rejected" }
      : { score: 95, relevance: 95, textSafety: 95, composition: 90, brandFit: 90, defects: [], hardDefects: [], summary: "Pass" };
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(qa) } }] }) };
  };
  try {
    const { generateSocialArtwork } = await import("../services/artwork/utils/artwork.js");
    const image = await generateSocialArtwork("Topic: planning applications. Show a missing certificate being checked.", { generationKey: "provider-recovery-test" });
    assert.equal(image, Buffer.from("image-2").toString("base64"));
    assert.equal(imageRequests.length, 2);
    assert.match(imageRequests[1].prompt, /Scanner scene misses the planning application/);
    assert.match(reviewBriefs[1], /missing certificate being checked/);
    assert.doesNotMatch(reviewBriefs[1], /Scanner scene misses the planning application/);
  } finally { globalThis.fetch = originalFetch; }
});
