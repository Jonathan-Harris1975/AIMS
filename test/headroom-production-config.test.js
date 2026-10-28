import test from "node:test";
import assert from "node:assert/strict";
import { headroomCompanion, restoreHeadroomProduction } from "../scripts/restoreHeadroomProduction.js";

const service = { id: "aims", app_id: "app" };
const companion = { id: "headroom", name: "headroom", app_id: "app", latest_deployment_id: "release" };
const deployment = { id: "release", service_id: "headroom", status: "HEALTHY" };

test("restore uses only the healthy, same-app Headroom companion and additive environment wiring", () => {
  const calls = [];
  const result = restoreHeadroomProduction({ env: { KOYEB_SERVICE: "aims", KOYEB_TOKEN: "test-only" }, run(args) {
    calls.push(args);
    if (args[0] === "deployments") return { deployment };
    if (args[1] === "get") return { service };
    if (args[1] === "list") return { services: [companion] };
    return null;
  } });
  assert.equal(result.enabled, true);
  assert.deepEqual(calls[1], ["services", "list", "--app", "app", "--name", "headroom"]);
  assert.deepEqual(calls.at(-2), ["services", "update", "headroom", "--min-scale", "1", "--deep-sleep-delay", "0", "--light-sleep-delay", "0",
    "--env", "HEADROOM_BEACON=off", "--env", "DO_NOT_TRACK=1"]);
  assert.deepEqual(calls.at(-1), ["services", "update", "aims", "--env", "HEADROOM_ENABLED=true", "--env",
    "HEADROOM_BASE_URL=http://headroom:8787", "--env", "HEADROOM_PROXY_TOKEN={{secret.HEADROOM_PROXY_TOKEN}}"]);
});

test("missing, ambiguous, unhealthy and mismatched companions cannot change AIMS", () => {
  for (const rows of [[], [companion, companion], [{ ...companion, app_id: "other" }]]) {
    assert.throws(() => headroomCompanion({ service }, { services: rows }, { deployment }));
  }
  for (const changed of [{ status: "failed" }, { service_id: "other" }, { id: "old" }]) {
    assert.throws(() => headroomCompanion(service, [companion], { ...deployment, ...changed }));
  }
  const calls = [];
  assert.throws(() => restoreHeadroomProduction({ env: { KOYEB_SERVICE: "aims", KOYEB_TOKEN: "test-only" }, run(args) {
    calls.push(args);
    return args[1] === "get" ? service : { services: [] };
  } }));
  assert.ok(!calls.some(args => args[1] === "update"));
});

test("committed production defaults keep Headroom enabled with a private companion address", async () => {
  const { readFile } = await import("node:fs/promises");
  const { parse } = await import("dotenv");
  const defaults = parse(await readFile(new URL("../config/production.defaults.env", import.meta.url)));
  assert.equal(defaults.HEADROOM_ENABLED, "true");
  assert.equal(defaults.HEADROOM_BASE_URL, "http://headroom:8787");
});
