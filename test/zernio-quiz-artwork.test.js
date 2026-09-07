import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { applyArtworkPromptPolicy } from "../services/artwork/utils/artworkPromptPolicy.js";

test("quiz artwork mode allows exact supplied text and demands four-option mobile layout", () => {
  const prompt = applyArtworkPromptPolicy(
    "Question card with A, B, C and D options",
    { date: "2026-07-29", mode: "quiz" },
  );

  assert.match(prompt, /Visible text is required for quiz artwork/i);
  assert.match(prompt, /all four answer choices A, B, C and D/i);
  assert.match(prompt, /Do not visually reveal the correct answer/i);
  assert.doesNotMatch(prompt, /ABSOLUTE TEXT-FREE OUTPUT/);
});

test("quiz images are stored in blogImages under zernio quiz prefix", async () => {
  const source = await readFile(
    new URL("../services/artwork/createQuizArtwork.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /uploadBuffer\("blogImages"/);
  assert.match(source, /zernio\/quiz\/\$\{safeSession\}-\$\{safeType\}\.png/);
});

test("quiz scheduler builds separate question and answer reveal artwork", async () => {
  const source = await readFile(
    new URL("../services/zernio/utils/socialScheduler.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /buildQuizQuestionArtworkPrompt/);
  assert.match(source, /buildQuizAnswerArtworkPrompt/);
  assert.match(source, /cardType: "question"/);
  assert.match(source, /cardType: "answer"/);
  assert.match(source, /Keep the three incorrect options visible but visually quieter/);
  assert.match(source, /Quiz topic:/);
  assert.match(source, /specific, recognisable real-world scene, mechanism, device, workflow or consequence/);
  assert.match(source, /Do not use generic AI wallpaper/);
  assert.match(source, /zernio-quiz-question-artwork-unavailable/);
  assert.match(source, /zernio-quiz-answer-artwork-unavailable/);
  assert.match(source, /refusing to schedule the static default image/);
});
