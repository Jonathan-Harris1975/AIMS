import test from "node:test";
import assert from "node:assert/strict";
import { sharedHeadroomServices, restoreHeadroomProduction, SHARED_HEADROOM } from "../scripts/restoreHeadroomProduction.js";

const aims = { id: "aims" };
const hive = { id: "hive", latest_deployment_id: "release" };
const deployment = { id: "release", service_id: "hive", status: "HEALTHY" };

test("restore reuses healthy HIVE and existing AIMS credential without creating a service", () => {
  const calls = [];
  const result = restoreHeadroomProduction({ env: { KOYEB_SERVICE: "aims", KOYEB_TOKEN: "test-only", HEADROOM_HIVE_SERVICE: "hive", HEADROOM_HIVE_BASE_URL: SHARED_HEADROOM.baseUrl }, run(args) {
    calls.push(args);
    if (args[0] === "deployments") return { deployment };
    if (args[1] === "get") return { service: args[2] === "aims" ? aims : hive };
    return null;
  } });
  assert.equal(result.enabled, true);
  assert.equal(result.additionalComputeService, false);
  assert.ok(!calls.some(args => args.includes("create") || args.includes("list")));
  assert.deepEqual(calls.at(-2), ["services", "update", "hive", "--min-scale", "1", "--env", "HEADROOM_ENABLED=true",
    "--env", "HEADROOM_BEACON=off", "--env", "DO_NOT_TRACK=1"]);
  assert.deepEqual(calls.at(-1), ["services", "update", "aims", "--env", "HEADROOM_ENABLED=true", "--env",
    `HEADROOM_BASE_URL=${SHARED_HEADROOM.baseUrl}`, "--env", "HEADROOM_PROXY_TOKEN={{secret.AIMS_API_KEY}}"]);
});

test("unhealthy, incorrect and mismatched service identities cannot change wiring", () => {
  for (const changed of [{ status: "failed" }, { service_id: "other" }, { id: "old" }]) {
    assert.throws(() => sharedHeadroomServices(aims, hive, { ...deployment, ...changed }, "hive"));
  }
  assert.throws(() => sharedHeadroomServices(aims, hive, deployment, "wrong"));
  assert.throws(() => sharedHeadroomServices(hive, hive, deployment, "hive"));
  const calls = [];
  assert.throws(() => restoreHeadroomProduction({ env: { KOYEB_SERVICE: "aims", KOYEB_TOKEN: "test-only", HEADROOM_HIVE_SERVICE: "hive", HEADROOM_HIVE_BASE_URL: SHARED_HEADROOM.baseUrl }, run(args) {
    calls.push(args);
    if (args[0] === "deployments") return { ...deployment, status: "failed" };
    return args[2] === "aims" ? aims : hive;
  } }));
  assert.ok(!calls.some(args => args[1] === "update"));
});

test("production defaults enable shared Headroom with a declared service-key binding", async () => {
  const { readFile } = await import("node:fs/promises");
  const { parse } = await import("dotenv");
  const defaults = parse(await readFile(new URL("../config/production.defaults.env", import.meta.url)));
  const overlay = parse(await readFile(new URL("../config/koyeb.production.env.template", import.meta.url)));
  assert.equal(defaults.HEADROOM_ENABLED, "true");
  assert.equal(defaults.HEADROOM_BASE_URL, SHARED_HEADROOM.baseUrl);
  assert.equal(overlay.HEADROOM_PROXY_TOKEN, "{{ secret.AIMS_API_KEY }}");
});


test("custom HIVE targets require a paired validated HTTPS origin before any Koyeb operation", () => {
  for (const target of [{ HEADROOM_HIVE_SERVICE: "replacement" }, { HEADROOM_HIVE_BASE_URL: "https://replacement.example" },
    { HEADROOM_HIVE_SERVICE: "replacement", HEADROOM_HIVE_BASE_URL: "http://replacement.example" },
    { HEADROOM_HIVE_SERVICE: "replacement", HEADROOM_HIVE_BASE_URL: "https://user:pass@replacement.example" }]) {
    let called = false;
    assert.throws(() => restoreHeadroomProduction({ env: { KOYEB_SERVICE: "aims", KOYEB_TOKEN: "test-only", ...target }, run() { called = true; } }));
    assert.equal(called, false);
  }
  const calls = [];
  restoreHeadroomProduction({ env: { KOYEB_SERVICE: "aims", KOYEB_TOKEN: "test-only", HEADROOM_HIVE_SERVICE: "hive", HEADROOM_HIVE_BASE_URL: "https://replacement.example" }, run(args) {
    calls.push(args);
    if (args[0] === "deployments") return deployment;
    if (args[1] === "get") return args[2] === "aims" ? aims : hive;
    return null;
  } });
  assert.ok(calls.at(-1).includes("HEADROOM_BASE_URL=https://replacement.example"));
});
