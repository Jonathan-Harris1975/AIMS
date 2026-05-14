import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { getDurableStateError, runDeploymentCheck } from "../deployment-check.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function buildBaseEnv(overrides = {}) {
  return {
    NODE_ENV: "production",
    OPENROUTER_API_BASE: "https://openrouter.example",
    OPENROUTER_API_KEY: "sk-or-test-key",
    APP_URL: "https://app.example.invalid",
    AUDIT_CALLBACK_TOKEN: "audit-callback-token",
    AUDIT_WEBSITE_REPO_OWNER: "test-owner",
    AUDIT_WEBSITE_REPO_NAME: "test-repo",
    GITHUB_TOKEN_WEBSITE_AUDITS: "github_pat_test",
    RAPIDAPI_HOST: "weatherapi-com.p.rapidapi.com",
    RAPIDAPI_KEY: "test-key",
    FEED_URL: "https://example.com/feed.xml",
    PODCAST_TITLE: "Test Podcast",
    PODCAST_AUTHOR: "Author",
    PODCAST_DESCRIPTION: "Description",
    PODCAST_LINK: "https://example.com",
    R2_ENDPOINT: "https://example.invalid",
    R2_ACCESS_KEY_ID: "access-key",
    R2_SECRET_ACCESS_KEY: "secret-key",
    R2_BUCKET_META_SYSTEM: "meta-system",
    R2_BUCKET_BRAND_ASSETS: "brand-assets",
    R2_PUBLIC_BASE_URL_BRAND_ASSETS: "https://assets.example.invalid",
    ...overrides,
  };
}

function runCli(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["deployment-check.js"], {
      cwd: repoRoot,
      env,
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

    child.once("error", reject);
    child.once("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

test("deployment-check CLI loads values from .env in the repository root", async () => {
  const envPath = path.join(repoRoot, ".env");
  const envContent = Object.entries(buildBaseEnv())
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  try {
    await fs.writeFile(envPath, `${envContent}\n`, "utf8");

    const result = await runCli({ PATH: process.env.PATH });

    assert.equal(result.code, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.match(result.stdout, /environment validation passed/i);
  } finally {
    await fs.rm(envPath, { force: true });
  }
});

test("deployment-check accepts legacy R2_META_BUCKET for durable state compatibility", () => {
  const env = buildBaseEnv({
    R2_BUCKET_META_SYSTEM: "",
    R2_META_BUCKET: "legacy-meta-bucket",
  });

  assert.equal(getDurableStateError(env), null);
  assert.equal(runDeploymentCheck(env), 0);
});

test("deployment-check rejects production envs without durable state configuration", () => {
  const env = buildBaseEnv({
    R2_ENDPOINT: "",
    R2_ACCESS_KEY_ID: "",
    R2_SECRET_ACCESS_KEY: "",
    R2_BUCKET_META_SYSTEM: "",
  });

  assert.match(
    getDurableStateError(env) || "",
    /state backend is not durable/i
  );
  assert.equal(runDeploymentCheck(env), 1);
});
