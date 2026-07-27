import test from "node:test";
import assert from "node:assert/strict";
import {
  AMERICAN_TO_BRITISH,
  applyBritishEnglishReplacements,
  findAmericanSpellings,
} from "../services/content-quality/britishEnglish.js";
import { getReviewCouncilMembers } from "../services/content-quality/reviewCouncil.js";

test("canonical British-English vocabulary covers common public-content drift", () => {
  const actual = new Map(AMERICAN_TO_BRITISH);
  for (const [american, british] of [
    ["analyze","analyse"], ["behavior","behaviour"], ["organization","organisation"],
    ["optimize","optimise"], ["prioritize","prioritise"], ["recognize","recognise"],
    ["realize","realise"], ["summarize","summarise"], ["authorize","authorise"],
    ["visualize","visualise"], ["standardize","standardise"], ["skeptical","sceptical"],
    ["artifact","artefact"], ["catalog","catalogue"],
  ]) {
    assert.equal(actual.get(american), british);
  }
});

test("computer program is not blindly rewritten to programme", () => {
  const repaired = applyBritishEnglishReplacements("The program analyzes behavior and optimizes the model.");
  assert.match(repaired, /\bprogram\b/);
  assert.doesNotMatch(repaired, /\bprogramme\b/);
  assert.match(repaired, /\banalyses\b/);
  assert.match(repaired, /\bbehaviour\b/);
  assert.match(repaired, /\boptimises\b/);
  assert.deepEqual(findAmericanSpellings(repaired), []);
});

test("all public content councils include language and GSP specialists", () => {
  for (const key of [
    "rss-rewrite-quarantine","blog-phase45","blotato-script-quality",
    "zernio-social-copy","zernio-ebook-conversion","quiz-logic","podcast-on-brand",
  ]) {
    const members = getReviewCouncilMembers(key);
    assert.ok(members.includes("British English Language Expert"), `${key} missing British English expert`);
    assert.ok(members.includes("Grammar, Spelling and Punctuation Expert"), `${key} missing GSP expert`);
  }
});
