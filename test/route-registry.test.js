import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.ALLOW_EPHEMERAL_STATE = "true";

const { routeRegistry } = await import("../routes/index.js");

test("central route registry mounts each service base path once", () => {
  const paths = routeRegistry.map((entry) => entry.path);
  const duplicates = paths.filter((path, index) => paths.indexOf(path) !== index);

  assert.deepEqual(duplicates, []);
});

