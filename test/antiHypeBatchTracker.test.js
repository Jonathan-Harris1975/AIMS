import test from "node:test";
import assert from "node:assert/strict";

import { validateAntiHype } from "../services/content-quality/validators/antiHypeValidator.js";
import {
  _resetAntiHypeBatchTrackerForTests,
  getAntiHypeBatchSnapshot,
  recordAntiHypeSample,
} from "../services/content-quality/validators/antiHypeBatchTracker.js";

test.beforeEach(() => {
  _resetAntiHypeBatchTrackerForTests();
});

test("recordAntiHypeSample accumulates total and flagged counts for the day", () => {
  recordAntiHypeSample({ flagged: false, source: "test" });
  recordAntiHypeSample({ flagged: true, source: "test" });
  recordAntiHypeSample({ flagged: false, source: "test" });

  const snapshot = getAntiHypeBatchSnapshot();
  assert.equal(snapshot.total, 3);
  assert.equal(snapshot.flagged, 1);
  assert.ok(Math.abs(snapshot.share - 1 / 3) < 1e-9);
});

test("validateAntiHype with emit:true records a sample even when the text is clean", () => {
  validateAntiHype("OpenAI cut GPT-5 API pricing by 40% for enterprise customers.", {
    source: "batch-test",
    emit: true,
  });
  const snapshot = getAntiHypeBatchSnapshot();
  assert.equal(snapshot.total, 1);
  assert.equal(snapshot.flagged, 0);
});

test("validateAntiHype with emit:false does not touch the batch tracker", () => {
  validateAntiHype("This is an unprecedented game-changer for the industry.", {
    source: "batch-test",
    emit: false,
  });
  const snapshot = getAntiHypeBatchSnapshot();
  assert.equal(snapshot.total, 0);
});

test("getAntiHypeBatchSnapshot returns zeroed snapshot for a day with no samples", () => {
  const snapshot = getAntiHypeBatchSnapshot("2000-01-01");
  assert.deepEqual(snapshot, { day: "2000-01-01", total: 0, flagged: 0, share: 0 });
});
