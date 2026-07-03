import test from "node:test";
import assert from "node:assert/strict";

import { validateAntiHype } from "../services/content-quality/validators/antiHypeValidator.js";
import {
  extractNamedEntities,
  requiresEntityRegeneration,
  validateEntityPreservation,
} from "../services/content-quality/validators/entityValidator.js";
import { validatePodcastMetadata, trimKeywordsToLimit } from "../services/content-quality/validators/metadataValidator.js";
import { validateSpokenCadence } from "../services/content-quality/validators/spokenCadenceValidator.js";
import { validateBrand } from "../services/content-quality/validators/brandValidator.js";
import { findGenericAbstractionBreaches } from "../services/content-quality/brandLexicon.js";

test("findGenericAbstractionBreaches flags landscape/revolution/paradigm terms", () => {
  const breaches = findGenericAbstractionBreaches("This is a paradigm shift in the AI landscape and a total revolution.");
  assert.ok(breaches.includes("landscape"));
  assert.ok(breaches.includes("paradigm"));
  assert.ok(breaches.includes("revolution"));
});

test("findGenericAbstractionBreaches does not flag clean concrete text", () => {
  const breaches = findGenericAbstractionBreaches(
    "OpenAI cut GPT-5 API pricing by 40% for enterprise customers starting Monday."
  );
  assert.deepEqual(breaches, []);
});

test("validateAntiHype reports generic abstraction defects with a concrete-effect instruction", () => {
  const result = validateAntiHype("This is an unprecedented game-changer for the industry.", { source: "test" });
  assert.equal(result.ok, false);
  assert.ok(result.defects.some((defect) => defect.includes("concrete effect")));
});

test("extractNamedEntities picks up Title Case runs and acronyms", () => {
  const entities = extractNamedEntities("OpenAI released GPT-5 today, and Sam Altman confirmed the news on X.");
  assert.ok(entities.some((entity) => entity.toLowerCase().includes("openai")));
  assert.ok(entities.some((entity) => entity.toLowerCase().includes("sam altman")));
});

test("requiresEntityRegeneration flags short, entity-thin summaries", () => {
  const check = requiresEntityRegeneration("A new model came out today and people are talking about it.");
  assert.equal(check.needsRegeneration, true);
});

test("requiresEntityRegeneration does not flag summaries with a named entity", () => {
  const check = requiresEntityRegeneration("OpenAI released GPT-5 today, cutting inference costs for enterprise users.");
  assert.equal(check.needsRegeneration, false);
});

test("validateEntityPreservation returns a regeneration prompt when thin", () => {
  const result = validateEntityPreservation({
    sourceText: "OpenAI released GPT-5 today with major pricing changes for enterprise API customers.",
    outputText: "A new model came out today and it changes some things.",
    source: "test",
  });
  assert.equal(result.ok, false);
  assert.match(result.regenerationPrompt, /organisation, person or technology/);
});

test("validatePodcastMetadata flags duplicate terms and over-cap keyword counts", () => {
  const result = validatePodcastMetadata({
    itunesKeywords: "AI, AI, machine learning, LLM, GPT, agents, safety, governance",
    maxKeywords: 6,
    source: "test",
  });
  assert.equal(result.ok, false);
  assert.ok(result.defects.some((defect) => defect.includes("duplicate")));
  assert.ok(result.defects.some((defect) => defect.includes("maximum curated cap")));
});

test("trimKeywordsToLimit deduplicates and respects the cap", () => {
  const trimmed = trimKeywordsToLimit("AI, ai, machine learning, LLM, GPT, agents, safety", 3);
  assert.equal(trimmed.length, 3);
  assert.deepEqual(trimmed, ["AI", "machine learning", "LLM"]);
});

test("validateSpokenCadence flags list-of-three enumerations with no example", () => {
  const result = validateSpokenCadence(
    "First, accuracy improved. Second, speed improved. Third, cost improved.",
    { source: "test" }
  );
  assert.equal(result.ok, false);
  assert.ok(result.defects.some((defect) => defect.includes("worked example")));
});

test("validateSpokenCadence passes when a worked example is present", () => {
  const result = validateSpokenCadence(
    "First, accuracy improved — for example, fewer wrong answers on medical questions. Second, speed improved. Third, cost improved.",
    { source: "test" }
  );
  assert.equal(result.ok, true);
});

test("validateBrand flags markdown, emoji, and excess hashtags", () => {
  const result = validateBrand("**Big news!** 🚀 #ai #tech #innovation #buildinpublic", { source: "test" });
  assert.equal(result.ok, false);
  assert.ok(result.defects.some((defect) => defect.includes("markdown")));
  assert.ok(result.defects.some((defect) => defect.includes("emoji")));
  assert.ok(result.defects.some((defect) => defect.includes("hashtags")));
});
