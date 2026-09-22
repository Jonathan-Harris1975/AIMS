import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadEnv } from "../config/loadEnv.js";

function runLoader(env) {
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "import './config/loadEnv.js'; console.log(JSON.stringify({ apiBase: process.env.BLOTATO_API_BASE, apiKey: process.env.BLOTATO_API_KEY || null, state: process.env.STATE_\
BACKEND, port: process.env.PORT }));",
    ],
    { cwd: process.cwd(), env, encoding: "utf8" }
  );
}

test("production defaults fill non-secret Blotato and state config without requiring Koyeb env", () => {
  const result = runLoader({ PATH: process.env.PATH });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, "");
  const loaded = JSON.parse(result.stdout.trim());
  assert.equal(loaded.apiBase, "https://backend.blotato.com/v2");
  assert.equal(loaded.state, "auto");
  assert.equal(loaded.port, "3000");
  assert.equal(loaded.apiKey, null);
});

test("real process env values override committed production defaults", () => {
  const result = runLoader({
    PATH: process.env.PATH,
    BLOTATO_API_BASE: "https://example.invalid/blotato",
    BLOTATO_API_KEY: "real-secret",
    STATE_BACKEND: "r2",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const loaded = JSON.parse(result.stdout.trim());
  assert.equal(loaded.apiBase, "https://example.invalid/blotato");
  assert.equal(loaded.apiKey, "real-secret");
  assert.equal(loaded.state, "r2");
});

test("dotenv parsing preserves process precedence and loads local development values quietly", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "aims-dotenv-"));
  const defaultsPath = path.join(directory, "production.defaults.env");
  const localPath = path.join(directory, ".env");
  await writeFile(defaultsPath, "SHARED=default\nDEFAULT_ONLY=from-defaults\n", "utf8");
  await writeFile(localPath, "SHARED=local\nLOCAL_ONLY=from-dotenv\n", "utf8");

  try {
    const env = { SHARED: "runtime" };
    const result = loadEnv({ env, defaultEnvPath: defaultsPath, localEnvPath: localPath });

    assert.deepEqual(env, {
      SHARED: "runtime",
      DEFAULT_ONLY: "from-defaults",
      LOCAL_ONLY: "from-dotenv",
    });
    assert.equal(result.defaultsLoaded, 2);
    assert.equal(result.localLoaded, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
