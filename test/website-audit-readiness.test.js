import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getWebsiteAuditReadiness } from "../audits/utils/websiteAuditReadiness.js";

function readyEnv() {
  return {
    R2_BUCKET_AUDITS: "audits",
    R2_ENDPOINT: "https://account.r2.cloudflarestorage.com",
    R2_ACCESS_KEY_ID: "access",
    R2_SECRET_ACCESS_KEY: "secret",
    APP_URL: "https://app.jonathan-harris.online",
    AUDIT_CALLBACK_TOKEN: "callback-secret",
    GITHUB_TOKEN_WEBSITE_AUDITS: "github-secret",
    AUDIT_WEBSITE_REPO_OWNER: "Jonathan-Harris1975",
    AUDIT_WEBSITE_REPO_NAME: "jonathan-harris-website",
    WEBSITE_AUDIT_TRIGGER_RAMS: "true",
    RAMS_BASE_URL: "https://mod.jonathan-harris.online",
    RMS_API_KEY: "shared-secret",
    RAMS_WAIT_FOR_COMPLETION: "true",
  };
}

test("website audit readiness passes only with the full AIMS to RAMS contract", () => {
  const readiness = getWebsiteAuditReadiness(readyEnv());
  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.missing, []);
});

test("website audit readiness rejects secret placeholders and missing completion wait", () => {
  const env = readyEnv();
  env.GITHUB_TOKEN_WEBSITE_AUDITS = "{{ secret.GITHUB_TOKEN_WEBSITE_AUDITS }}";
  env.RAMS_WAIT_FOR_COMPLETION = "false";
  const readiness = getWebsiteAuditReadiness(env);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.missing.includes("GITHUB_TOKEN_WEBSITE_AUDITS"));
  assert.ok(readiness.missing.includes("RAMS_WAIT_FOR_COMPLETION=true"));
});

test("website audit operational pretriggers are fail-closed even when global strict mode is disabled", () => {
  const source = readFileSync(new URL("../services/ops/index.js", import.meta.url), "utf8");
  assert.match(source, /websiteAuditStrict\s*=\s*meta\.service\s*===\s*["']audits["']/);
  assert.match(source, /["']\/audits\/website\/run["']/);
  assert.match(source, /["']\/audits\/monthly\/website["']/);
  assert.match(source, /configuredStrict\s*\|\|\s*websiteAuditStrict/);
  assert.match(source, /strictReason:\s*websiteAuditStrict\s*\?/);
});
