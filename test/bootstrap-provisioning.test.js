import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function waitForExit(child, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`child process timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

test("state file module import does not await remote R2 hydration", async () => {
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "import('./services/shared/utils/stateFile.js').then(() => { console.log('imported'); process.exit(0); })",
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        NODE_ENV: "production",
        LOG_LEVEL: "silent",
        STATE_BACKEND: "r2",
        R2_ENDPOINT: "https://example.invalid",
        R2_ACCESS_KEY_ID: "test-access",
        R2_SECRET_ACCESS_KEY: "test-secret",
        R2_BUCKET_META_SYSTEM: "metasystem",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  const result = await waitForExit(child, 12_000);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /imported/);
});

test("bootstrap exposes health before optional RSS initialisation", async () => {
  const port = 43_000 + Math.floor(Math.random() * 1_000);
  const child = spawn(process.execPath, ["scripts/bootstrap.js"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      LOG_LEVEL: "silent",
      PORT: String(port),
      STARTUP_CHECK_REQUIRED_POST_START: "false",
      RSS_INIT_ON_BOOT: "false",
      SERVER_LISTEN_TIMEOUT_MS: "5000",
      BOOTSTRAP_STEP_TIMEOUT_MS: "1000",
      R2_ENDPOINT: "https://example.invalid",
      R2_ACCESS_KEY_ID: "test-access",
      R2_SECRET_ACCESS_KEY: "test-secret",
      R2_BUCKET_META_SYSTEM: "metasystem",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  try {
    let response;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        response = await fetch(`http://127.0.0.1:${port}/health`);
        if (response.ok) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    assert.ok(response?.ok, `health did not respond before timeout; stdout=${stdout}; stderr=${stderr}`);
    const body = await response.json();
    assert.equal(body.ok, true);
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child, 10_000).catch(() => null);
  }
});
