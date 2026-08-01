import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("request dedupe uses scheduler idempotency headers and contains no legacy relay dependency", async () => {
  const source = await readFile(new URL("services/shared/utils/requestDedupe.js", root), "utf8");
  assert.match(source, /x-idempotency-key/);
  assert.match(source, /x-trigger-run-key/);
  assert.match(source, /REQUEST_DEDUPE_TTL_MS/);
  assert.equal(source.toLowerCase().includes(["hook", "deck"].join("")), false);
});

test("the repository no longer references the retired relay", async () => {
  const files = [
    "server.js",
    "env.template",
    "config/production.defaults.env",
    "services/shared/utils/asyncServiceRouteJobs.js",
    "audits/routes/website.js",
  ];
  for (const file of files) {
    const source = await readFile(new URL(file, root), "utf8");
    assert.equal(source.toLowerCase().includes(["hook", "deck"].join("")), false, file);
  }
});
