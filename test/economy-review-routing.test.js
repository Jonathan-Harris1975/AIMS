import test from "node:test";
import assert from "node:assert/strict";

test("economy editorial reviews preserve strong factual and writing routes", async () => {
  const values = {
    OPENROUTER_API_KEY: "test-only",
    AI_MODEL_FAST: "openai/gpt-5.6-luna",
    AI_MODEL_SUMMARY: "openai/gpt-5.6-luna",
    AI_MODEL_AUDIT: "openai/gpt-5.6-sol",
    AI_MODEL_HIGH_QUALITY: "anthropic/claude-sonnet-5.5",
    OPENROUTER_GPT_5_6_SOL: "openai/gpt-5.6-sol",
    NEWSLETTER_MODEL_EDITORIAL: "anthropic/claude-sonnet-5.5",
    OUTREACH_ARTICLE_MODEL: "article-writer",
    OUTREACH_PITCH_MODEL: "pitch-writer",
    OUTREACH_REPLY_MODEL: "reply-writer",
  };
  const prior = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    const { aiConfig } = await import(`../ai-config.js?economy=${Date.now()}`);
    const modelFor = route => aiConfig.models[aiConfig.routeModels[route][0]].name;
    for (const route of ["newsletterVoiceReview", "newsletterAudienceReview"]) {
      assert.equal(modelFor(route), values.AI_MODEL_FAST);
      assert.ok(aiConfig.routeModels[route].includes("gpt56Sol"));
    }
    assert.equal(modelFor("newsletterCompose"), values.NEWSLETTER_MODEL_EDITORIAL);
    assert.equal(modelFor("newsletterFactCheck"), values.AI_MODEL_HIGH_QUALITY);
    assert.deepEqual(aiConfig.routeModels.newsletterFactCheck, ["highQuality", "audit"]);
    assert.equal(modelFor("newsletterCouncilChair"), values.AI_MODEL_HIGH_QUALITY);
    assert.deepEqual(aiConfig.routeModels.newsletterCouncilChair, ["highQuality", "audit"]);
    assert.equal(modelFor("commsHubOutreachPitch"), "pitch-writer");
    assert.equal(modelFor("commsHubOutreachReply"), "reply-writer");
    assert.equal(modelFor("commsHubOutreachArticle"), "article-writer");
    delete process.env.OUTREACH_PITCH_MODEL;
    delete process.env.OUTREACH_REPLY_MODEL;
    assert.equal(aiConfig.models.outreachPitch.name, "article-writer");
    assert.equal(aiConfig.models.outreachReply.name, "article-writer");
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
