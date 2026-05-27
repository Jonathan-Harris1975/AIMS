import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const BUILD_ONLY_ENV = {
  ...process.env,
  BLOTATO_NEWS_TEMPLATE_ID: "base/v2/ai-story-video/5903fe43-514d-40ee-a060-0d662...",
  BLOTATO_API_KEY: "{{ secret.BLOTATO-API-KEY }}",
  BLOTATO_VIDEO_POLL_ATTEMPTS: "not-a-number",
};

test("build check does not validate runtime-only Koyeb environment variables", () => {
  const result = spawnSync(process.execPath, ["scripts/buildCheck.js"], {
    cwd: process.cwd(),
    env: BUILD_ONLY_ENV,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Build check passed/);
});
