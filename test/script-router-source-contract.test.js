import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const rootRegistryUrl = new URL("../routes/index.js", import.meta.url);
const canonicalRouterUrl = new URL("../services/script/routes/index.js", import.meta.url);

test("production mounts only the canonical script router", async () => {
  const registry = await readFile(rootRegistryUrl, "utf8");

  assert.match(
    registry,
    /import scriptRoutes from "\.\.\/services\/script\/routes\/index\.js";/
  );
  assert.match(
    registry,
    /\{ path: "\/script", name: "Script", routes: scriptRoutes \}/
  );

  for (const filename of ["intro.js", "main.js", "outro.js"]) {
    await assert.rejects(
      access(new URL(`../services/script/routes/${filename}`, import.meta.url)),
      (error) => error?.code === "ENOENT",
      `${filename} must not reappear as a parallel production route`
    );
  }
});

test("canonical script generation routes retain schema validation and deduplication", async () => {
  const source = await readFile(canonicalRouterUrl, "utf8");

  assert.match(source, /import \{ requestDedupe \} from "\.\.\/\.\.\/shared\/utils\/requestDedupe\.js";/);
  assert.match(source, /function validateOrThrow\(schema, body\)/);
  assert.match(source, /const parsed = parseSchema\(schema, body\)/);

  const contracts = [
    ["intro", "IntroSchema"],
    ["main", "MainSchema"],
    ["outro", "OutroSchema"],
    ["compose", "ComposeSchema"],
    ["orchestrate", "OrchestrateSchema"],
  ];

  for (const [route, schema] of contracts) {
    const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const routeBlock = new RegExp(
      `router\\.post\\("/${escapedRoute}", requestDedupe\\("script:${escapedRoute}"\\),[\\s\\S]*?validateOrThrow\\(${schema}, req\\.body\\)`
    );
    assert.match(source, routeBlock, `${route} must remain validated and deduplicated`);
  }
});
