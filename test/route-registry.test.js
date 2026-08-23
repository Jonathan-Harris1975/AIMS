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



test("runtime version fallback matches package version and container probes liveness", async () => {
  const { readFile } = await import("node:fs/promises");
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const serverSource = await readFile(new URL("../server.js", import.meta.url), "utf8");
  const dockerSource = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
  const composeSource = await readFile(new URL("../docker-compose.yml", import.meta.url), "utf8");
  assert.equal(typeof packageJson.version, "string");
  assert.match(serverSource, /const PACKAGE_VERSION = require\("\.\/package\.json"\)\?\.version \|\| "unknown";/);
  assert.match(serverSource, /process\.env\.APP_VERSION \|\| PACKAGE_VERSION/);
  assert.match(dockerSource, /\/livez/);
  assert.match(composeSource, /\/livez/);
});
