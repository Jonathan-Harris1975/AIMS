import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { assertRelativeImportGraph } from "../scripts/utils/relativeImportGraph.js";

test("relative import graph accepts nested readable modules", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aims-import-graph-"));
  await mkdir(path.join(root, "nested"));
  await writeFile(path.join(root, "entry.js"), 'import "./nested/child.js";\n');
  await writeFile(path.join(root, "nested", "child.js"), 'export { value } from "./value.js";\n');
  await writeFile(path.join(root, "nested", "value.js"), 'export const value = 1;\n');

  const result = await assertRelativeImportGraph(root, ["entry.js"]);
  assert.deepEqual(result, { entryModulesChecked: 1, modulesChecked: 3 });
});

test("relative import graph rejects a missing deployment file with its importer", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aims-import-graph-"));
  await writeFile(path.join(root, "entry.js"), 'import "./missing.js";\n');

  await assert.rejects(
    assertRelativeImportGraph(root, ["entry.js"]),
    /Missing relative import '\.\/missing\.js' referenced from entry\.js/
  );
});
