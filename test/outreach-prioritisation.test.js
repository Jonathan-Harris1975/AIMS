import test from "node:test";
import assert from "node:assert/strict";
import { sortEditorialOpportunities } from "../services/outreach/services/serp-OutreachService.js";

test("editorial relevance outranks authority when prioritising verified opportunities", () => {
  const largeButWeakFit = { domain: "large.example", editorialRelevanceScore: 15,
    editorialEvidence: { classification: "confirmed", recentActivity: true }, emails: [{}, {}],
    authority: { tier: "A", totalScore: 90 } };
  const smallStrongFit = { domain: "niche.example", editorialRelevanceScore: 25,
    editorialEvidence: { classification: "confirmed", recentActivity: true }, emails: [{}],
    authority: { tier: "C", totalScore: 10 } };
  assert.deepEqual(sortEditorialOpportunities([largeButWeakFit, smallStrongFit]).map((row) => row.domain),
    ["niche.example", "large.example"]);
});