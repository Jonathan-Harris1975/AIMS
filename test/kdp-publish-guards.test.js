import test from "node:test";
import assert from "node:assert/strict";
import { publishBlockers } from "../services/kdp/engine/kdpPublish.ts";
import { clickPublish } from "../services/kdp/engine/kdpWizard.ts";

test("publishing is blocked on failed steps even when their error list is empty", () => {
  assert.deepEqual(publishBlockers([{ step: "pricing", success: false, errors: [] }], []), ["Step failed: pricing"]);
  assert.deepEqual(publishBlockers([{ step: "details", success: true, errors: [] }], ["validation error"]), ["validation error"]);
  assert.deepEqual(publishBlockers([{ step: "details", success: true, errors: [] }], []), []);
});

test("publishing never falls back to an arbitrary visible submit button", async () => {
  const page = {
    keyboard: { press: async () => {} },
    locator: () => ({ isVisible: async () => false }),
    evaluate: async () => null,
    getByRole: () => ({ first: () => ({ isVisible: async () => false }) }),
    waitForTimeout: async () => {},
  };
  await assert.rejects(clickPublish(page), /Could not click KDP button/);
});
