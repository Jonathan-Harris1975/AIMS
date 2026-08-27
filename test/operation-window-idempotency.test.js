import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("daily operation windows are one-shot after completion unless explicitly forced", async () => {
  const source = await readFile(new URL("../services/ops/index.js", import.meta.url), "utf8");
  assert.match(source, /const forceRerun = \[req\.query\?\.force, req\.body\?\.force, req\.get\?\.\("x-operation-force"\)\]/);
  assert.match(source, /if \(existing && !forceRerun\)/);
  assert.match(source, /same-day-window-already-executed/);
  assert.match(source, /same-day-window-already-running/);
});
