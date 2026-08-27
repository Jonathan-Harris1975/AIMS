import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { getCommsHubReadiness } from "../services/comms-hub/config.js";

function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i >= 0) out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

const defaults = parseEnv(fs.readFileSync(new URL("../config/production.defaults.env", import.meta.url), "utf8"));

test("production defaults activate every Comms Hub conversation channel plus autonomous maintenance", () => {
  for (const key of [
    "COMMS_HUB_ENABLED", "COMMS_HUB_AI_ENABLED", "COMMS_HUB_ZERNIO_META_ENABLED",
    "COMMS_HUB_ZERNIO_VIDEO_ENABLED", "COMMS_HUB_ZERNIO_POLL_ENABLED",
    "COMMS_HUB_EMAIL_ENABLED", "COMMS_HUB_EMAIL_POLL_WORKER_ENABLED",
    "COMMS_HUB_EMAIL_WORKFLOW_EVALUATION_ENABLED", "COMMS_HUB_CHAT_ENABLED",
    "COMMS_HUB_CHAT_AI_WORKFLOW_ENABLED", "COMMS_HUB_FORM_ORCHESTRATION_ENABLED",
    "COMMS_HUB_FORM_SMART_PROCESSING_ENABLED", "COMMS_HUB_FORM_AUTO_SEND_ENABLED",
    "COMMS_HUB_AUTONOMOUS_REPLIES_ENABLED", "COMMS_HUB_DELAYED_ACTION_WORKER_ENABLED",
    "COMMS_HUB_FOLLOW_UP_WORKER_ENABLED", "COMMS_HUB_PROVIDER_HEALTH_ENABLED"
  ]) assert.equal(defaults[key], "true", key);
  assert.equal(defaults.COMMS_HUB_SOCIAL_MONITOR_ONLY, "false");
  assert.equal(defaults.COMMS_HUB_EMAIL_HISTORICAL_BACKFILL_ENABLED, "false");
  assert.equal(defaults.COMMS_HUB_EMAIL_EXTERNAL_RECIPIENTS_ENABLED, "false");
  assert.equal(defaults.COMMS_HUB_EMAIL_ADMIN_ENABLED, "false");
  assert.equal(defaults.COMMS_HUB_EMAIL_NEWSLETTER_ENABLED, "false");
  assert.equal(defaults.COMMS_HUB_APPROVALS_ENFORCED, "true");
  assert.equal(defaults.COMMS_HUB_HUMAN_HANDOFF_BUSINESS_HOURS_ONLY, "true");
  assert.equal(defaults.AIMS_OPERATION_OUTREACH_ENABLED, "true");
  assert.equal(defaults.COMMS_HUB_BACKUP_ENABLED, "true");
  assert.equal(defaults.COMMS_HUB_BACKUP_AUTOMATIC_ENABLED, "true");
  assert.equal(defaults.COMMS_HUB_RETENTION_WORKER_ENABLED, "true");
  assert.equal(defaults.COMMS_HUB_MODEL_FREE_PRIMARY, "dots-studio/dots-3-note-preview:free");
  assert.equal(defaults.COMMS_HUB_MODEL_FREE_BACKUP, "");
  assert.equal(defaults.COMMS_HUB_MODEL_FREE_FALLBACK, "");
  assert.equal(defaults.COMMS_HUB_MODEL_PAID_ECONOMY, "openai/gpt-oss-20b");
});

test("full production profile is readiness-complete when deployment secrets are supplied", () => {
  const env = {
    ...defaults,
    D1_UUID: "db-id", D1_API_KEY: "d1-token",
    R2_ENDPOINT: "https://account.r2.cloudflarestorage.com",
    R2_ACCESS_KEY_ID: "r2-access", R2_SECRET_ACCESS_KEY: "r2-secret",
    CLOUDFLARE_ACCOUNT_ID: "cf-account",
    JOTFORM_API_KEY: "jotform-token",
    COMMS_HUB_ATTACHMENT_SCANNER_TOKEN: "scanner-token",
    COMMS_HUB_ONECOM_PASSWORD: "mail-password",
    COMMS_HUB_COGINPAL_WEBHOOK_SECRET: "chat-secret",
    COMMS_HUB_AI_SEARCH_INSTANCES: "search-prod",
    CLOUDFLARE_AI_SEARCH_API_TOKEN: "search-token",
    COMMS_HUB_PUBLIC_BASE_URL: "https://zeroth-kara-jonathanharris-3296ed37.koyeb.app",
    COMMS_HUB_D1_PROXY_URL: "https://d1-proxy.example.test",
    COMMS_HUB_D1_PROXY_TOKEN: "d1-proxy-token",
    COMMS_HUB_RESTORE_DATABASE_ID: "restore-db-id",
    ZERNIO_META_API_KEY: "meta-key", ZERNIO_META_WEBHOOK_SECRET: "meta-secret",
    ZERNIO_VIDEO_API_KEY: "video-key", ZERNIO_VIDEO_WEBHOOK_SECRET: "video-secret",
  };
  const readiness = getCommsHubReadiness(env);
  assert.equal(readiness.ready, true, JSON.stringify(readiness.missing));
  assert.equal(readiness.zernio.meta.status, "configured");
  assert.equal(readiness.zernio.video.status, "configured");
});

test("full-channel migration executes and activates conservative policy-gated reply lanes", () => {
  const db = new DatabaseSync(":memory:");
  for (const name of [
    "0001_comms_hub.sql", "0002_zernio_social.sql", "0003_ai_workflows.sql", "0004_hardening.sql",
    "0005_operations_and_channels.sql", "0006_smart_response_forms.sql", "0007_business_hours_and_handoff.sql",
    "0008_full_channel_activation.sql",
  ]) db.exec(fs.readFileSync(new URL(`../services/comms-hub/migrations/${name}`, import.meta.url), "utf8"));
  const policies = db.prepare("SELECT policy_key, channel, status, approved_by FROM comms_hub_autonomous_reply_policies ORDER BY policy_key").all();
  assert.deepEqual(policies.map((p) => [p.policy_key, p.channel, p.status, p.approved_by]), [
    ["full-chat-low-risk", "chat", "active", "owner-activation"],
    ["full-email-low-risk", "email", "active", "owner-activation"],
    ["full-social-low-risk", "social", "active", "owner-activation"],
  ]);
});

test("Outreach is enabled in AIMS and owned by the external MAST clock, not duplicated inside content windows", () => {
  const source = fs.readFileSync(new URL("../services/ops/index.js", import.meta.url), "utf8");
  assert.match(source, /AIMS_OPERATION_OUTREACH_ENABLED/);
  assert.doesNotMatch(source, /outreach-disabled-until-dedicated-setup/);
  assert.doesNotMatch(source, /\["outreach", "\/outreach\/batch\/next"/);
});

test("autonomous governance reads persisted Comms Hub confidence and risk fields", async () => {
  const { resolveAutonomousAssessment } = await import("../services/comms-hub/governanceService.js");
  assert.deepEqual(
    resolveAutonomousAssessment({
      state: { intent_confidence: 0.96, risk_level: "low" },
      runs: [{ reputational_risk: 0.03 }],
    }),
    { risk: 0.03, confidence: 0.96 },
  );

  assert.deepEqual(
    resolveAutonomousAssessment({
      state: { intent_confidence: 0.97, risk_level: "high" },
      runs: [{ reputational_risk: 0.02 }],
    }),
    { risk: 0.65, confidence: 0.97 },
  );
});
