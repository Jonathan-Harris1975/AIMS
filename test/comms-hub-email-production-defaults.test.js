import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

const defaults = parseEnv(fs.readFileSync(new URL("../config/production.defaults.env", import.meta.url), "utf8"));

test("production defaults enable the live info mailbox and poll worker", () => {
  assert.equal(defaults.COMMS_HUB_EMAIL_ENABLED, "true");
  assert.equal(defaults.COMMS_HUB_EMAIL_POLL_WORKER_ENABLED, "true");
  assert.equal(defaults.COMMS_HUB_ONECOM_EMAIL_ADDRESS, "info@jonathan-harris.online");
  assert.equal(defaults.COMMS_HUB_ONECOM_USERNAME, "info@jonathan-harris.online");
  assert.equal(defaults.COMMS_HUB_EMAIL_ADMIN_ADDRESS, "admin@jonathan-harris.online");
  assert.equal(defaults.COMMS_HUB_EMAIL_ADMIN_ENABLED, "true");
  assert.equal(defaults.COMMS_HUB_EMAIL_ADMIN_USERNAME, "admin@jonathan-harris.online");
  assert.equal(defaults.COMMS_HUB_EMAIL_ADMIN_MAILBOX, "INBOX");
  assert.equal(defaults.COMMS_HUB_EMAIL_NEWSLETTER_ADDRESS, "newsletter@jonathan-harris.online");
  assert.equal(defaults.COMMS_HUB_EMAIL_NEWSLETTER_ENABLED, "true");
  assert.equal(defaults.COMMS_HUB_EMAIL_NEWSLETTER_USERNAME, "newsletter@jonathan-harris.online");
  assert.equal(defaults.COMMS_HUB_EMAIL_NEWSLETTER_MAILBOX, "INBOX");
  assert.equal(defaults.COMMS_HUB_ONECOM_IMAP_HOST, "imap.one.com");
  assert.equal(defaults.COMMS_HUB_ONECOM_IMAP_PORT, "993");
  assert.equal(defaults.COMMS_HUB_ONECOM_SMTP_HOST, "send.one.com");
  assert.equal(defaults.COMMS_HUB_ONECOM_SMTP_PORT, "465");
  assert.equal(defaults.COMMS_HUB_EMAIL_HISTORICAL_BACKFILL_ENABLED, "false");
  assert.equal(defaults.COMMS_HUB_EMAIL_WORKFLOW_EVALUATION_ENABLED, "true");
});
