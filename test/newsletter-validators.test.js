import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  validateBannedPhrases,
  validateBritishSpelling,
  validateSubjectLength,
  validateStructuralCompleteness,
  validateNoDuplicateStories,
  validateLinks,
  validatePromotion,
  runDeterministicValidators,
} from "../services/newsletter/engine/validators.js";

function baseNewsletter(overrides = {}) {
  return {
    subject: "OpenAI ships a smaller, faster model",
    previewText: "Plus: what actually matters in the rest of today's AI news.",
    heroHeadline: "OpenAI ships a smaller, faster model",
    openingNoteHtml: "<p>Three stories survived the noise filter today.</p>",
    heroImageUrl: "https://images.example.com/hero.png",
    bigThree: [
      { title: "A", link: "https://news.example.com/a", whatHappened: "A happened.", whyItMatters: "It matters.", jonathanTake: "Worth watching." },
      { title: "B", link: "https://news.example.com/b", whatHappened: "B happened.", whyItMatters: "It matters.", jonathanTake: "Useful, with limits." },
      { title: "C", link: "https://news.example.com/c", whatHappened: "C happened.", whyItMatters: "It matters.", jonathanTake: "Evidence first." },
    ],
    worthUsing: { title: "D", link: "https://news.example.com/d", label: "Worth Watching", summary: "D summary.", whyUseful: "Practical relevance." },
    onRadar: [
      { title: "E", link: "https://news.example.com/e", summary: "E summary." },
      { title: "F", link: "https://news.example.com/f", summary: "F summary." },
    ],
    realityCheck: { claim: "The claim", assessment: "The evidence is narrower than the headline.", link: "https://news.example.com/a" },
    yourTurn: "Which development deserves a deeper look?",
    promotion: null,
    ...overrides,
  };
}

describe("newsletter engine/validators.js", () => {
  test("flags marketing hype", () => {
    const nl = baseNewsletter();
    nl.bigThree[0].jonathanTake = "This is revolutionary and game-changing.";
    assert.equal(validateBannedPhrases(nl).pass, false);
  });

  test("flags Americanisms", () => {
    const nl = baseNewsletter({ openingNoteHtml: "<p>We analyze the color and behavior.</p>" });
    assert.equal(validateBritishSpelling(nl).pass, false);
  });

  test("flags an overlong subject", () => {
    assert.equal(validateSubjectLength(baseNewsletter({ subject: "X".repeat(90) })).pass, false);
  });

  test("requires exactly three Big Three stories", () => {
    const result = validateStructuralCompleteness(baseNewsletter({ bigThree: baseNewsletter().bigThree.slice(0, 2) }));
    assert.equal(result.pass, false);
    assert.ok(result.issues.some((i) => i.code === "big_three_incomplete"));
  });

  test("allows Reality Check to cite a Big Three source without treating it as duplication", () => {
    assert.equal(validateNoDuplicateStories(baseNewsletter()).pass, true);
  });

  test("catches duplicated editorial slots", () => {
    const nl = baseNewsletter();
    nl.onRadar[1].link = nl.onRadar[0].link;
    assert.equal(validateNoDuplicateStories(nl).pass, false);
  });

  test("validates promotion shape and URL", () => {
    const good = baseNewsletter({ promotion: { type: "podcast", title: "Turing's Torch", url: "https://jonathan-harris.online/podcast/" } });
    assert.equal(validatePromotion(good).pass, true);
    assert.equal(validateLinks(good).pass, true);
  });

  test("passes clean v2 input", () => {
    const result = runDeterministicValidators(baseNewsletter(), { expectedStoryCount: 6 });
    assert.equal(result.pass, true);
    assert.deepEqual(result.issues, []);
  });
});
