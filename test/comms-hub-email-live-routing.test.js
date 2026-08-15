import test from "node:test";
import assert from "node:assert/strict";
import { CommsHubEmailService } from "../services/comms-hub/emailService.js";
import { loadCommsHubConfig } from "../services/comms-hub/config.js";

function parsed(overrides = {}) {
  return {
    from: { address: "sender@example.com", name: "Sender" },
    to: [{ address: "info@jonathan-harris.online" }],
    cc: [],
    subject: "Customer enquiry",
    text: "Hello",
    html: "",
    messageId: "<m1@example.com>",
    inReplyTo: "",
    references: [],
    receivedAt: "2026-08-14T12:00:00.000Z",
    rawSha256: "abc",
    attachments: [{
      filename: "document.pdf",
      contentType: "application/pdf",
      buffer: Buffer.from("safe-test"),
      size: 9,
      sha256: "def",
    }],
    ...overrides,
  };
}

function context() {
  return {
    config: {
      emailEnabled: true,
      oneComEmailAccountKey: "info",
      oneComEmailAddress: "info@jonathan-harris.online",
      emailAddressRoles: {
        admin: { address: "admin@jonathan-harris.online", purpose: "service_admin", commsHubManaged: false },
        info: { address: "info@jonathan-harris.online", purpose: "customer_facing", commsHubManaged: true },
        newsletter: { address: "newsletter@jonathan-harris.online", purpose: "newsletter_brevo", commsHubManaged: false },
      },
      emailWorkflowEvaluationEnabled: false,
    },
    operationsRepository: {
      async findEmailThread() { return null; },
      async persistChannelMessage() { return { duplicate: false }; },
      async ensureConversationOperations() {},
      async upsertEmailThread() {},
      async addContactAlias() {},
      async indexSearchDocument() {},
    },
    repository: {
      async getConversation() { return null; },
      async markAttachmentStatus() {},
    },
    attachmentService: {
      async ingest() { return { quarantined: false }; },
    },
    workflowEngineService: {
      async evaluate() { throw new Error("workflow evaluation must remain off during channel setup"); },
    },
  };
}

test("info@ is the managed customer-facing Comms Hub mailbox", async () => {
  const c = context();
  let saved;
  c.operationsRepository.persistChannelMessage = async (value) => { saved = value; return { duplicate: false }; };
  const result = await new CommsHubEmailService({ context: c }).persistFetched({ uid: 501, parsed: parsed(), mailbox: "INBOX" });
  assert.equal(result.workflow, "email_inbox");
  assert.equal(result.managedAddress, "info@jonathan-harris.online");
  assert.equal(saved.conversation.metadata.mailboxRole, "customer_facing");
  assert.equal(result.attachments[0].status, "stored");
});

test("quarantined attachment does not discard the parent info@ email", async () => {
  const c = context();
  c.attachmentService.ingest = async () => {
    throw Object.assign(new Error("infected"), { code: "attachment_infected", failureClass: "permanent" });
  };
  const result = await new CommsHubEmailService({ context: c }).persistFetched({ uid: 502, parsed: parsed(), mailbox: "INBOX" });
  assert.equal(result.workflow, "email_inbox");
  assert.equal(result.attachments[0].status, "quarantined");
  assert.equal(result.attachments[0].error, "attachment_infected");
});

test("email role map keeps admin and newsletter outside the customer inbox worker", () => {
  const env = {
    COMMS_HUB_ENABLED: "false",
    COMMS_HUB_EMAIL_PRIMARY_ADDRESS: "info@jonathan-harris.online",
    COMMS_HUB_EMAIL_ADMIN_ADDRESS: "admin@jonathan-harris.online",
    COMMS_HUB_EMAIL_NEWSLETTER_ADDRESS: "newsletter@jonathan-harris.online",
  };
  const cfg = loadCommsHubConfig(env);
  assert.equal(cfg.emailAddressRoles.info.commsHubManaged, true);
  assert.equal(cfg.emailAddressRoles.admin.commsHubManaged, false);
  assert.equal(cfg.emailAddressRoles.newsletter.commsHubManaged, false);
  assert.equal(cfg.emailAddressRoles.newsletter.purpose, "newsletter_brevo");
});
