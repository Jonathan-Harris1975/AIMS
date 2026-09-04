import assert from "node:assert/strict";
import test from "node:test";
import { classifyOperationDuplicate } from "../services/ops/operationDuplicate.js";

test("terminal duplicate operation windows settle instead of advertising more work", () => {
  assert.deepEqual(
    classifyOperationDuplicate("same-day-window-recovery-exhausted", {
      status: "completed-with-failures",
      failures: 1,
      terminal: true,
    }),
    { httpStatus: 200, ok: false, terminal: true, retryable: false },
  );

  assert.deepEqual(
    classifyOperationDuplicate("same-day-window-already-executed", {
      status: "completed",
      failures: 0,
      terminal: true,
    }),
    { httpStatus: 200, ok: true, terminal: true, retryable: false },
  );

  assert.deepEqual(
    classifyOperationDuplicate("same-day-window-recovery-cooldown", {
      status: "completed-with-failures",
      failures: 1,
    }),
    { httpStatus: 202, ok: true, terminal: false, retryable: true },
  );
});
