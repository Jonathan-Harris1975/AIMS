import test from "node:test";
import assert from "node:assert/strict";
import { createAndReviewPitch } from "../services/outreach/bookFeature/pitchWorkflow.js";

const allGates = { factual: true, evidence: true, relevance: true, mutualBenefit: true, tone: true,
  originality: true, legal: true, links: true, contactIdentity: true, optOut: true };
const facts = { organisation: { name: "Example", officialDomain: "example.com" },
  contact: { email: "editor@example.com", role: "Editor" },
  book: { title: "Practical AI", url: "https://jonathan-harris.online/books/practical-ai" },
  evidence: [{ passage: "A verified mention." }] };

test("pitch workflow archives immutable draft and independent passing QA with measured usage", async () => {
  const stored = []; const persisted = [];
  const responses = [
    { content: JSON.stringify({ subject: "A practical feature idea",
      body: "Your verified work is relevant to a concise feature about Practical AI. " +
        "It offers a useful perspective for readers without inventing claims. " +
        "If this is not useful, reply no thanks and I will stop." }),
      metadata: { route: "draft-route" }, usage: { prompt_tokens: 100, completion_tokens: 80, cost: 0.003 } },
    { content: JSON.stringify({ score: 96, gates: allGates, reasons: [] }), metadata: { route: "qa-route" },
      usage: { prompt_tokens: 90, completion_tokens: 40, cost: 0.002 } },
  ];
  const repository = { recordPitchVersion: async (row) => { stored.push(row); return { version: row.version, passed: row.qa.passed }; } };
  const result = await createAndReviewPitch({ opportunityId: "opp", campaignId: "campaign", facts,
    allowedUrls: [facts.book.url] }, { repository, request: async () => responses.shift(),
    persist: async (...args) => persisted.push(args) });
  assert.equal(result.status, "qa_passed");
  assert.equal(stored.length, 1);
  assert.equal(stored[0].draftMetadata.measuredCostUsd, 0.003);
  assert.equal(stored[0].reviewMetadata.modelRoute, "qa-route");
  assert.match(stored[0].contentHash, /^[a-f0-9]{64}$/);
  assert.equal(persisted[0][1], "outreach/book-feature/pitches/opp/v1.json");
});

test("pitch workflow permits one repair only and keeps failed versions", async () => {
  let calls = 0; const versions = [];
  const pitch = { subject: "A practical feature idea",
    body: "A carefully grounded feature could be useful to your readers and is based only on verified context. If it is not relevant, reply no thanks and I will stop." };
  const request = async (_route, options) => {
    calls++;
    if (options.section.includes("qa")) return { content: JSON.stringify({ score: 70,
      gates: { ...allGates, evidence: false }, reasons: ["Evidence support is incomplete"] }), metadata: { route: "qa" }, usage: {} };
    return { content: JSON.stringify(pitch), metadata: { route: "draft" }, usage: {} };
  };
  const repository = { recordPitchVersion: async (row) => { versions.push(row); return { version: row.version, passed: false }; } };
  const result = await createAndReviewPitch({ opportunityId: "opp", campaignId: "campaign", facts }, {
    repository, request, persist: async () => {} });
  assert.equal(result.status, "qa_failed");
  assert.equal(result.repairBudgetExhausted, true);
  assert.equal(versions.length, 2);
  assert.equal(calls, 4);
});
