import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { advisoryDailySocialGate } from "../services/blog/social/dailySocialQa.js";

test("daily social style and format findings remain visible as audit advisories", () => {
  const defects = [
    "British English drift: use organise instead of organize",
    "Banned or hype phrase detected: game changer",
    "Sentence length exceeds the autonomous readability limit of 24 words.",
    "Social caption is too thin for autonomous scheduling.",
    "Too many hashtags for organic cross-platform posting.",
    "Caption is too long for the organic visual social lane.",
  ];
  const result = advisoryDailySocialGate({ ok: false, score: 72, defects }, "daily-review-exhausted");

  assert.equal(result.ok, true);
  assert.equal(result.advisory, true);
  assert.equal(result.publicationBlocked, false);
  assert.deepEqual(result.advisoryDefects, defects);
  assert.deepEqual(result.originalDefects, defects);
  assert.deepEqual(result.warnings, defects);
});

test("daily social factual, source, schema and unknown findings continue to block", () => {
  const defects = [
    "Unsupported number or date-like token: 2026",
    "Unsupported direct quote fragment: unsupported wording",
    "No source records supplied for source-backed publication.",
    "Missing application/ld+json structured data block.",
    "Unrecognised review defect",
  ];
  const result = advisoryDailySocialGate({ ok: false, score: 40, defects });

  assert.equal(result.ok, false);
  assert.equal(result.advisory, false);
  assert.equal(result.publicationBlocked, true);
  assert.deepEqual(result.blockingDefects, defects);
  assert.deepEqual(result.advisoryDefects, []);
});

test("mixed daily social findings block when any hard defect remains", () => {
  const result = advisoryDailySocialGate({
    ok: false,
    defects: [
      "British English drift: use organise instead of organize",
      "Unsupported number or date-like token: 2026",
    ],
  });

  assert.equal(result.publicationBlocked, true);
  assert.deepEqual(result.advisoryDefects, ["British English drift: use organise instead of organize"]);
  assert.deepEqual(result.blockingDefects, ["Unsupported number or date-like token: 2026"]);
});

test("explicit hard-failure metadata and malformed gates fail closed", () => {
  const explicitHardFailure = advisoryDailySocialGate({
    ok: false,
    defects: ["British English drift: use organise instead of organize"],
    hardFailure: true,
  });
  const malformed = advisoryDailySocialGate({ ok: false, defects: "missing array" });

  assert.equal(explicitHardFailure.publicationBlocked, true);
  assert.match(explicitHardFailure.blockingDefects[0], /explicit hard failure/i);
  assert.equal(malformed.ok, false);
  assert.equal(malformed.publicationBlocked, true);
});

test("daily social council fallbacks quarantine residual hard defects before publication", async () => {
  const source = await readFile(new URL("../services/blog/social/buildDailySocialBlogPost.js", import.meta.url), "utf8");

  assert.match(source, /import \{ advisoryDailySocialGate \} from "\.\/dailySocialQa\.js"/);
  assert.equal((source.match(/if \(phase[45]Gate\.publicationBlocked\)/g) || []).length, 4);
  assert.match(source, /daily-phase4-hard-defect/);
  assert.match(source, /daily-phase5-hard-defect/);
  assert.match(source, /daily-phase4-final-hard-defect/);
  assert.match(source, /daily-phase5-final-hard-defect/);
});
