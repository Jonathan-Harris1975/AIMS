import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Friday podcast uses canonical episode naming and a locked 60-minute plan", async () => {
  const source = await readFile(new URL("../services/ops/index.js", import.meta.url), "utf8");
  assert.match(source, /return `TT-\$\{londonDate\}`/);
  assert.match(source, /payload\.targetMinutes = 60/);
});

test("podcast publication requires newly generated episode artwork", async () => {
  const source = await readFile(new URL("../services/podcast/runPodcastPipeline.js", import.meta.url), "utf8");
  assert.match(source, /artwork\?\.source !== "generated"/);
  assert.match(source, /!artwork\?\.key/);
});
