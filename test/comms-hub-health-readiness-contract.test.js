import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("Comms Hub health and AIMS readiness fail closed when the service is disabled", () => {
  const routerSource = fs.readFileSync(new URL("../services/comms-hub/routes/index.js", import.meta.url), "utf8");
  const serverSource = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  const startupSource = fs.readFileSync(new URL("../scripts/startupCheck.js", import.meta.url), "utf8");
  assert.match(routerSource, /const ready = configuration\.enabled && configuration\.ready && runtime\.ready;/);
  assert.match(routerSource, /health: \{ \.\.\.health, revision: process.env.KOYEB_GIT_SHA \|\| null \}/);
  assert.match(serverSource, /ok: configuration\.enabled && configuration\.ready && runtime\.ready,/);
  assert.match(startupSource, /Production state backend is not durable/);
  assert.match(startupSource, /Production KOYEB_GIT_SHA must be the exact 40-character lowercase deployed Git commit SHA/);
});
