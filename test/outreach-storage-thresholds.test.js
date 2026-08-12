import assert from "node:assert/strict";
import test from "node:test";

import { resolveOutreachThresholds } from "../services/outreach/config.js";
import { extractGoodLeads } from "../services/outreach/utils/filters.js";
import { readFile } from "node:fs/promises";

test("outreach production thresholds favour backlink lead quality", () => {
  assert.deepEqual(resolveOutreachThresholds({}), {
    testMode: false,
    minAuthorityScore: 14,
    minLeadScore: 18,
    minEmailScore: 0.5,
  });
});

test("outreach test mode lowers thresholds without changing production defaults", () => {
  const env = { OUTREACH_TEST_MODE: "true" };
  assert.deepEqual(resolveOutreachThresholds(env), {
    testMode: true,
    minAuthorityScore: 8,
    minLeadScore: 10,
    minEmailScore: 0.2,
  });

  const leads = extractGoodLeads([
    { domain: "example.com", da: 8, serpPosition: 4, email: "editor@example.com", emailScore: 0.25 },
  ], "ai backlinks", env);
  assert.equal(leads.length, 1);
});

test("outreach lead store targets the Comms Hub R2 bucket", async () => {
  const source = await readFile(new URL("../services/outreach/services/leadStore.js", import.meta.url), "utf8");
  assert.match(source, /putJson\("commsHub", key, payload\)/);
  assert.match(source, /outreachLeadPrefix/);
  assert.doesNotMatch(source, /googleapis|spreadsheets/i);
});
