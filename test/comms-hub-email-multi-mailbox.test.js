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
    ONECOM_ADMIN_PASSWORD: "admin-secret",
    ONECOM_NEWSLETTER_PASSWORD: "newsletter-secret",
  };
}

test("config exposes three independent one.com mailboxes with admin/newsletter manual-only", () => {
  const config = loadCommsHubConfig(baseEnv());
  assert.deepEqual(Object.keys(config.emailAccounts), ["info", "admin", "newsletter"]);
  assert.equal(config.emailAccounts.info.address, "info@jonathan-harris.online");
  assert.equal(config.emailAccounts.info.manualOnly, false);
  assert.equal(config.emailAccounts.admin.address, "admin@jonathan-harris.online");
  assert.equal(config.emailAccounts.admin.password, "admin-secret");
  assert.equal(config.emailAccounts.admin.manualOnly, true);
  assert.equal(config.emailAccounts.admin.workflowEvaluationEnabled, false);
  assert.equal(config.emailAccounts.newsletter.address, "newsletter@jonathan-harris.online");
  assert.equal(config.emailAccounts.newsletter.password, "newsletter-secret");
  assert.equal(config.emailAccounts.newsletter.manualOnly, true);
  assert.equal(config.emailAccounts.newsletter.workflowEvaluationEnabled, false);
});

function parsed(to) {
  return {
    from: { address: "editor@example.com", name: "Editor" },
    to: [{ address: to }],
    cc: [],
    subject: "Mailbox test",
    text: "Hello Jonathan",
    html: "",
    messageId: `<${to}-1@example.com>`,
    inReplyTo: "",
    references: [],
    receivedAt: "2026-08-17T09:00:00.000Z",
    rawSha256: "abc",
    attachments: [],
  };
}

function inboundContext(accountKey) {
  const address = `${accountKey}@jonathan-harris.online`;
  let evaluated = false;
  let automationKicked = false;
  const config = {
    emailEnabled: true,
    badLanguageBlockEnabled: true,
    emailWorkflowEvaluationEnabled: true,
    emailAccounts: {
      [accountKey]: {
        key: accountKey,
        enabled: true,
        address,
        username: address,
        password: "secret",
        mailbox: "INBOX",
        mailboxRole: accountKey === "admin" ? "service_admin" : "newsletter",
        manualOnly: true,
        workflowEvaluationEnabled: false,
      },
    },
  };
  const state = { saved: null, thread: null };
  return {
    state,
    config,
    operationsRepository: {
      async findEmailThread() { return null; },
      async persistChannelMessage(value) { state.saved = value; return { duplicate: false }; },
      async ensureConversationOperations() {},
      async upsertEmailThread(value) { state.thread = value; },
      async addContactAlias() {},
      async indexSearchDocument() {},
    },
    repository: { async getConversation() { return null; } },
    attachmentService: { async ingest() { return { quarantined: false }; } },
    workflowEngineService: { async evaluate() { evaluated = true; } },
    get evaluated() { return evaluated; },
    get automationKicked() { return automationKicked; },
  };
}

test("admin and newsletter intake are stored separately and do not run inbound email automation", async () => {
  for (const accountKey of ["admin", "newsletter"]) {
    const context = inboundContext(accountKey);
    const service = new CommsHubEmailService({ context });
    const result = await service.persistFetched({
      uid: 10,
      parsed: parsed(`${accountKey}@jonathan-harris.online`),
      mailbox: "INBOX",
      accountKey,
      managedAddress: `${accountKey}@jonathan-harris.online`,
      mailboxRole: accountKey === "admin" ? "service_admin" : "newsletter",
      automationEnabled: false,
    });
    assert.equal(result.accountKey, accountKey);
    assert.equal(result.manualOnly, true);
    assert.equal(context.state.saved.conversation.metadata.accountKey, accountKey);
    assert.equal(context.state.saved.conversation.metadata.manualOnly, true);
    assert.equal(context.state.thread.accountKey, accountKey);
    assert.equal(context.evaluated, false);
  }
});

test("manual-only mailbox rejects automated send but an operator reply uses that mailbox identity", async () => {
  const sent = [];
  const conversation = {
    id: "cnv_test",
    channel: "email",
    subject: "Admin request",
    status: "open",
    contact: { primary_email: "person@example.com" },
    messages: [{ direction: "inbound", received_at: "2026-08-17T09:00:00.000Z" }],
  };
  const context = {
    config: {
      emailEnabled: true,
      emailExternalRecipientsEnabled: false,
      emailInitialReplyDelayEnabled: false,
      emailMaxReplyChars: 20000,
      badLanguageBlockEnabled: true,
      emailAccounts: {
        admin: {
          key: "admin", enabled: true, address: "admin@jonathan-harris.online",
          username: "admin@jonathan-harris.online", password: "secret", mailbox: "INBOX",
          mailboxRole: "service_admin", manualOnly: true, workflowEvaluationEnabled: false,
        },
      },
    },
    repository: { async getConversation() { return conversation; } },
    operationsRepository: {
      async getConversationWorkspace() { return { operations: { operational_status: "open" }, emailThread: { id: "eth1", account_key: "admin", mailbox: "INBOX", references_json: "[]", internet_message_id: "<in@example.com>", provider_thread_key: "thread1" } }; },
      async claimChannelOutboundAction() { return { acquired: true }; },
      async recordOutboundMessage(value) { sent.push(value); },
      async upsertEmailThread() {},
      async completeChannelOutboundAction() {},
      async failChannelOutboundAction() {},
    },
    oneComMailAccounts: {
      admin: {
        async sendMessage(message) {
          assert.equal(message.to[0], "person@example.com");
          return { messageId: "<out@example.com>" };
        },
      },
    },
    oneComMail: null,
    attachmentService: { async get() { throw new Error("not used"); } },
  };
  const service = new CommsHubEmailService({ context });
  await assert.rejects(
    () => service.send({ conversationId: conversation.id, bodyText: "Automated reply", idempotencyKey: "auto-1" }),
    (error) => error?.code === "email_mailbox_manual_only",
  );
  const result = await service.send({ conversationId: conversation.id, bodyText: "Manual reply", idempotencyKey: "manual-1", manualReply: true });
  assert.equal(result.providerMessageId, "<out@example.com>");
  assert.equal(sent[0].sender, "admin@jonathan-harris.online");
});
