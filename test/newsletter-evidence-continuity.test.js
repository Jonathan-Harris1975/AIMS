import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { enrichArticleEvidence } from "../services/newsletter/engine/articleEvidence.js";
import { sourcePayload } from "../services/newsletter/engine/editorialCouncil.js";
import { buildQaRepairPrompt } from "../services/artwork/utils/artwork.js";

test("Friday weekend edition council receives only source-verified original article evidence", async () => {
  const verified = {
    title: "A verified source", summary: "A limited RSS synopsis",
    link: "https://example.org/news", publishedAt: "2026-11-13T09:00:00Z",
    evidenceVerified: true, evidence: "Independent original article evidence. ".repeat(15),
  };
  const unverified = { title: "A preview source", summary: "A short factual preview",
    link: "https://example.org/short", evidenceVerified: false,
    evidence: "Unverified details must not reach council reviewers" };
  let fetchCount = 0;
  const enriched = await enrichArticleEvidence([verified, unverified], {
    fetchOne: async x => { fetchCount += 1; return { ...x, evidenceVerified: false }; },
  });
  assert.equal(fetchCount, 1);
  const payload = sourcePayload(enriched[0], [enriched[1]]);
  assert.equal(payload[0].evidenceVerified, true);
  assert.ok(payload[0].originalArticleEvidence.includes("Independent original article evidence"));
  assert.equal(payload[1].evidenceVerified, false);
  assert.equal("originalArticleEvidence" in payload[1], false);
});

test("newsletter composition and targeted repair forbid inventing unsupported source statistics", async () => {
  const [composer, repair, qa, defaults] = await Promise.all([
    readFile(new URL("../services/newsletter/engine/compose.js", import.meta.url), "utf8"),
    readFile(new URL("../services/newsletter/engine/targetedRepair.js", import.meta.url), "utf8"),
    readFile(new URL("../services/newsletter/engine/qaLoop.js", import.meta.url), "utf8"),
    readFile(new URL("../config/production.defaults.env", import.meta.url), "utf8"),
  ]);
  assert.match(composer, /EVIDENCE LOCK/);
  assert.match(repair, /DELETE or soften the unsupported words/);
  assert.match(qa, /repairs: 6, recoveries: 4/);
  assert.match(defaults, /^NEWSLETTER_QA_PASS_THRESHOLD=85$/m);
});

test("failed Zernio social image repair leads with QA defects before model truncation", () => {
  const brief = "A source-specific AI model uncertainty in a professional setting " + "extra context ".repeat(250);
  const result = buildQaRepairPrompt(brief, {
    hardDefects: ["Visible fabricated whiteboard text"],
    defects: ["Off-topic server racks"],
  });
  assert.ok(result.indexOf("Visible fabricated whiteboard text") < result.indexOf("Editorial subject:"));
  assert.ok(result.indexOf("Off-topic server racks") < result.indexOf("Editorial subject:"));
  assert.ok(result.length < 1800, "repair prompt remains short enough to preserve corrections");
  assert.match(result, /an entirely different source-specific photograph/);
});
