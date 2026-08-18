import test from "node:test";
import assert from "node:assert/strict";
import { loadCommsHubConfig } from "../services/comms-hub/config.js";
import { CommsHubEmailService } from "../services/comms-hub/emailService.js";

function baseEnv() {
  return {
    COMMS_HUB_ENABLED: "false",
    COMMS_HUB_EMAIL_ENABLED: "true",
    COMMS_HUB_EMAIL_ADMIN_ENABLED: "true",
    COMMS_HUB_EMAIL_NEWSLETTER_ENABLED: "true",
    COMMS_HUB_ONECOM_ACCOUNT_KEY: "info",
    COMMS_HUB_ONECOM_EMAIL_ADDRESS: "info@jonathan-harris.online",
    COMMS_HUB_ONECOM_USERNAME: "info@jonathan-harris.online",
    ONECOM_INFO_PASSWORD: "info-secret",
    ONECOM_ADMIN_PASSWORD: "stale-admin-secret",
    ONECOM_NEWSLETTER_PASSWORD: "stale-newsletter-secret",
  };
}

test("stale Admin/Newsletter flags and credentials cannot add Comms Hub mailboxes", () => {
  const config = loadCommsHubConfig(baseEnv());
  assert.deepEqual(Object.keys(config.emailAccounts), ["info"]);
  assert.equal(config.emailAccounts.info.address, "info@jonathan-harris.online");
  assert.deepEqual(Object.keys(config.excludedEmailAccounts), ["admin", "newsletter"]);
  assert.equal(config.excludedEmailAccounts.admin.automationExcluded, true);
  assert.equal(config.excludedEmailAccounts.newsletter.automationExcluded, true);
});

function parsed(to) {
  return {
    from: { address: "editor@example.com", name: "Editor" },
    to: [{ address: to }], cc: [], subject: "Mailbox test", text: "Hello Jonathan", html: "",
    messageId: `<${to}-1@example.com>`, inReplyTo: "", references: [],
    receivedAt: "2026-08-17T09:00:00.000Z", rawSha256: "abc", attachments: [],
  };
}

function intakeContext() {
  let persisted = false;
  return {
    config: loadCommsHubConfig(baseEnv()),
    operationsRepository: {
      async findEmailThread() { return null; },
      async persistChannelMessage() { persisted = true; return { duplicate: false }; },
    },
    repository: { async getConversation() { return null; } },
    get persisted() { return persisted; },
  };
}

test("Admin and Newsletter intake are rejected before message persistence", async () => {
  for (const accountKey of ["admin", "newsletter"]) {
    const context = intakeContext();
    const service = new CommsHubEmailService({ context });
    await assert.rejects(
      () => service.persistFetched({ uid: 10, parsed: parsed(`${accountKey}@jonathan-harris.online`), mailbox: "INBOX", accountKey }),
      (error) => error?.code === "email_mailbox_automation_excluded",
    );
    assert.equal(context.persisted, false);
  }
});

test("legacy Admin/Newsletter conversations cannot send even with the manual-reply flag", async () => {
  for (const accountKey of ["admin", "newsletter"]) {
    let claimed = false;
    const conversation = {
      id: `cnv-${accountKey}`, channel: "email", subject: "Legacy request", status: "open",
      contact: { primary_email: "person@example.com" },
      messages: [{ direction: "inbound", received_at: "2026-08-17T09:00:00.000Z" }],
    };
    const context = {
      config: loadCommsHubConfig(baseEnv()),
      repository: { async getConversation() { return conversation; } },
      operationsRepository: {
        async getConversationWorkspace() {
          return { operations: { operational_status: "open" }, emailThread: { account_key: accountKey, mailbox: "INBOX" } };
        },
        async claimChannelOutboundAction() { claimed = true; return { acquired: true }; },
      },
    };
    const service = new CommsHubEmailService({ context });
    await assert.rejects(
      () => service.send({ conversationId: conversation.id, bodyText: "Manual reply", idempotencyKey: `${accountKey}-1`, manualReply: true }),
      (error) => error?.code === "email_mailbox_automation_excluded",
    );
    assert.equal(claimed, false);
  }
});
