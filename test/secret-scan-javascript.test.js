import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const scanner = new URL("../scripts/secret_scan.py", import.meta.url).pathname;

function runScanner(root) {
  return spawnSync("python3", [scanner, root], {
    encoding: "utf8",
  });
}

test("secret scanner rejects literal JavaScript environment credentials", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "aims-secret-scan-"));
  try {
    await writeFile(
      path.join(root, "leak.js"),
      ['process.env.', 'OPENROUTER_API_KEY', ' = \"production-looking-credential-value\";\n'].join(''),
    );
    const result = runScanner(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /literal value assigned to OPENROUTER_API_KEY/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("secret scanner permits computed synthetic JavaScript test credentials", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "aims-secret-scan-"));
  try {
    await writeFile(
      path.join(root, "fixture.js"),
      ['process.env.', 'OPENROUTER_API_KEY', ' = [\"synthetic\", \"openrouter\", \"credential\"].join(\"-\");\n'].join(''),
    );
    const result = runScanner(root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Secret scan passed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
