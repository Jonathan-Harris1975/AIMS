import test from "node:test";
import assert from "node:assert/strict";
import { applyPinnedAssignments } from "../services/shared/utils/pinnedModelDefaults.js";

test("pinned startup defaults preserve approved models without a selector or external writes", () => {
  const previous = process.env.AI_MODEL_FAST;
  const secret = process.env.PINNED_TEST_UNRELATED;
  try {
    applyPinnedAssignments({ AI_MODEL_FAST: "approved/model", PINNED_TEST_UNRELATED: "ignore" });
    assert.equal(process.env.AI_MODEL_FAST, "approved/model");
    assert.equal(process.env.PINNED_TEST_UNRELATED, secret);
    assert.throws(() => applyPinnedAssignments({ AI_MODEL_FAST: "replacement/model", AI_MODEL_STANDARD: "" }));
    assert.equal(process.env.AI_MODEL_FAST, "approved/model", "invalid snapshots must not partially alter defaults");
  } finally {
    if (previous === undefined) delete process.env.AI_MODEL_FAST; else process.env.AI_MODEL_FAST = previous;
  }
});
