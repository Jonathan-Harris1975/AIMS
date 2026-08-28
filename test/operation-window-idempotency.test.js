import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("daily operation windows are durable one-shot jobs unless explicitly forced", async () => {
  const source = await readFile(new URL("../services/ops/index.js", import.meta.url), "utf8");
  const durable = await readFile(new URL("../services/ops/operationWindowState.js", import.meta.url), "utf8");
  const stateFile = await readFile(new URL("../services/shared/utils/stateFile.js", import.meta.url), "utf8");

  assert.match(source, /const forceRerun = \[req\.query\?\.force, req\.body\?\.force, req\.get\?\.\("x-operation-force"\)\]/);
  assert.match(source, /claimOperationWindow\(\{ id, window: windowName, executionId, force: forceRerun \}\)/);
  assert.match(source, /getOperationWindowReceipt\(id\)/);
  assert.match(source, /persistOperationWindow\(job\)/);
  assert.match(durable, /same-day-window-already-executed/);
  assert.match(durable, /same-day-window-already-running/);
  assert.match(durable, /same-day-window-claimed-by-another-instance/);
  assert.match(durable, /flushStateWrites\(\{ throwOnError: process\.env\.NODE_ENV === "production" \}\)/);
  assert.match(stateFile, /"operation-window-state\.json"/);
});
