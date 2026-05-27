import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function runLoader(env) {
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "import './config/loadEnv.js'; console.log(JSON.stringify({ apiBase: process.env.BLOTATO_API_BASE, apiKey: process.env.BLOTATO_API_KEY || null, state: process.env.STATE_BACKEND, port: process.env.PORT }));",
    ],
    { cwd: process.cwd(), env, encoding: "utf8" }
  );
}

test("production defaults fill non-secret Blotato and state config without requiring Koyeb env", () => {
  const result = runLoader({ PATH: process.env.PATH });

  assert.equal(result.status, 0, result.stderr || result.stdout);
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
