import assert from "node:assert/strict";
import test from "node:test";

import { bestEmail } from "../services/outreach/services/outreachService.js";
import { classifyEditorialEvidence, scoreOpportunity } from "../services/outreach/utils/qualification.js";
import { isAuthorisedOutreachSession, londonParts } from "../services/outreach/utils/schedule.js";

test("editorial evidence is classified conservatively", () => {
  const confirmed = classifyEditorialEvidence({
    sourceUrl: "https://example.com/write-for-us",
    pageText: "We accept contributed articles and provide contributor guidelines.",
  });
  assert.equal(confirmed.classification, "confirmed");
  assert.equal(classifyEditorialEvidence({ sourceUrl: "https://example.com/insights", pageText: "Recent guest authors and an editorial contact route." }).classification, "strong_probable");
  assert.equal(classifyEditorialEvidence({ sourceUrl: "https://example.com", pageText: "Sponsored post only. Pay to publish." }).classification, "unsuitable");
  assert.equal(classifyEditorialEvidence({ sourceUrl: "https://example.com/blog", pageText: "Our blog publishes company news." }).classification, "unconfirmed");
});

test("qualification follows the versioned rubric and mandatory gates", () => {
  const evidence = classifyEditorialEvidence({
    sourceUrl: "https://example.com/contributors",
    pageText: "We accept contributed articles about AI governance. Contact the editor for contributor guidelines.",
  });
  const qualified = scoreOpportunity({
    keyword: "AI governance",
    evidence,
    contact: { eligible: true, editorialContact: true, role: true },
    validation: { status: "valid" },
    authority: { openPageRank: 4 },
  });
  assert.equal(qualified.total, 90);
  assert.equal(qualified.qualified, true);
  assert.equal(scoreOpportunity({ evidence, contact: { eligible: false }, validation: { status: "valid" } }).qualified, false);
});

test("recipient ranking rejects generic non-editorial and cross-domain contacts", () => {
  const entry = {
    domain: "example.com",
    editorialEvidence: { classification: "confirmed", editorialRoute: true },
    emails: [
      { email: "info@example.com", validation: { status: "valid" }, hunter: { type: "generic" } },
      { email: "editor@example.com", validation: { status: "valid" }, hunter: { type: "generic", department: "Editorial" } },
      { email: "editor@other.example", validation: { status: "valid" }, hunter: { type: "generic" } },
    ],
  };
  assert.equal(bestEmail(entry).email, "editor@example.com");
  assert.equal(bestEmail({ ...entry, editorialEvidence: { classification: "confirmed", editorialRoute: false } }), null);
});

test("authorised outreach sessions use Europe/London and only Monday, Wednesday and Friday mornings", () => {
  assert.deepEqual(londonParts(new Date("2026-01-05T09:00:00.000Z")), { weekday: "monday", date: "2026-01-05", hour: 9, minute: 0 });
  assert.equal(isAuthorisedOutreachSession(new Date("2026-01-05T09:00:00.000Z")), true);
  assert.equal(isAuthorisedOutreachSession(new Date("2026-07-06T07:59:00.000Z")), false);
  assert.equal(isAuthorisedOutreachSession(new Date("2026-07-06T09:00:00.000Z")), true);
  assert.equal(isAuthorisedOutreachSession(new Date("2026-07-07T09:00:00.000Z")), false);
  assert.equal(isAuthorisedOutreachSession(new Date("2026-07-06T11:00:00.000Z")), false);
});

