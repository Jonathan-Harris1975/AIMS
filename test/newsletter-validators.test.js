import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  validateBannedPhrases,
  validateBritishSpelling,
  validateSubjectLength,
  validateStructuralCompleteness,
  validateNoDuplicateStories,
  validateLinks,
  runDeterministicValidators,
} from "../services/newsletter/engine/validators.js";

function baseNewsletter(overrides = {}) {
  return {
    subject: "OpenAI ships a smaller, faster model",
    previewText: "Plus: three other stories worth your attention today.",
    heroHeadline: "OpenAI ships a smaller, faster model",
    leadArticleHtml: "<p>OpenAI released a new model today.</p>",
    heroImageUrl: "https://images.example.com/hero.png",
    sourceLink: "https://news.example.com/a",
    stories: [
      { title: "Story A", link: "https://news.example.com/b", summary: "Summary A." },
      { title: "Story B", link: "https://news.example.com/c", summary: "Summary B." },
    ],
    ...overrides,
  };
}

describe("newsletter engine/validators.js", () => {
  test("validateBannedPhrases flags marketing hype", () => {
    const result = validateBannedPhrases(baseNewsletter({ leadArticleHtml: "<p>This is a revolutionary, game-changing model.</p>" }));
    assert.equal(result.pass, false);
    assert.ok(result.issues.some((i) => i.code === "banned_phrase"));
  });

  test("validateBannedPhrases passes clean copy", () => {
    const result = validateBannedPhrases(baseNewsletter());
    assert.equal(result.pass, true);
  });

  test("validateBritishSpelling flags Americanisms", () => {
    const result = validateBritishSpelling(baseNewsletter({ leadArticleHtml: "<p>We analyze the color of the model's behavior.</p>" }));
    assert.equal(result.pass, false);
    assert.ok(result.issues.length >= 2);
  });

  test("validateSubjectLength flags an overlong subject", () => {
    const result = validateSubjectLength(baseNewsletter({ subject: "X".repeat(90) }));
    assert.equal(result.pass, false);
    assert.equal(result.issues[0].code, "subject_too_long");
  });

  test("validateSubjectLength flags a missing subject", () => {
    const result = validateSubjectLength(baseNewsletter({ subject: "" }));
    assert.equal(result.pass, false);
    assert.equal(result.issues[0].code, "missing_subject");
  });

  test("validateStructuralCompleteness catches a missing hero image", () => {
    const result = validateStructuralCompleteness(baseNewsletter({ heroImageUrl: null }));
    assert.equal(result.pass, false);
    assert.ok(result.issues.some((i) => i.code === "missing_hero_image"));
  });

  test("validateStructuralCompleteness catches a short story count", () => {
    const result = validateStructuralCompleteness(baseNewsletter(), { expectedStoryCount: 10 });
    assert.equal(result.pass, false);
    assert.ok(result.issues.some((i) => i.code === "story_count_short"));
  });

  test("validateNoDuplicateStories catches a repeated link", () => {
    const nl = baseNewsletter();
    nl.stories[1].link = nl.stories[0].link;
    const result = validateNoDuplicateStories(nl);
    assert.equal(result.pass, false);
  });

  test("validateLinks catches a malformed URL", () => {
    const nl = baseNewsletter();
    nl.stories[0].link = "not-a-url";
    const result = validateLinks(nl);
    assert.equal(result.pass, false);
    assert.ok(result.issues.some((i) => i.code === "malformed_link"));
  });

  test("runDeterministicValidators aggregates all checks and passes clean input", () => {
    const result = runDeterministicValidators(baseNewsletter(), { expectedStoryCount: 2 });
    assert.equal(result.pass, true);
    assert.deepEqual(result.issues, []);
  });
});
