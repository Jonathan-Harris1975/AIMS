import test from "node:test";
import assert from "node:assert/strict";
import { kickInboundConversationAutomation, runInboundConversationAutomation } from "../services/comms-hub/inboundAutomationService.js";

test("inbound automation analyses and sends only an eligible no-approval draft", async () => {
  const calls = [];
  const context = {
    config: { aiEnabled: true, autonomousRepliesEnabled: true },
    aiWorkflowService: {
      async analyseConversation(conversationId, options) {
        calls.push(["analyse", conversationId, options]);
        return { draft: { id: "draft-1", requiresApproval: false } };
      },
    },
    governanceService: {
      async attemptAutonomousReply(input, identity) {
        calls.push(["send", input, identity]);
        return { ok: true };
      },
    },
  };
  const result = await runInboundConversationAutomation({ context, conversationId: "cnv-1", actor: "test-automation" });
  assert.equal(result.sent, true);
  assert.equal(calls[0][0], "analyse");
  assert.equal(calls[1][0], "send");
  assert.equal(calls[1][2].actor, "test-automation");
});

test("inbound automation stops before send when the draft requires approval", async () => {
  let sent = false;
  const context = {
    config: { aiEnabled: true, autonomousRepliesEnabled: true },
    aiWorkflowService: { async analyseConversation() { return { draft: { id: "draft-2", requiresApproval: true } }; } },
    governanceService: { async attemptAutonomousReply() { sent = true; } },
  };
  const result = await runInboundConversationAutomation({ context, conversationId: "cnv-2" });
  assert.equal(result.reason, "approval_required");
  assert.equal(sent, false);
});

test("email automation creates an internal warning when a draft requires human approval", async () => {
  const notifications = [];
  const context = {
    config: { aiEnabled: true, autonomousRepliesEnabled: true },
    repository: {
      async getConversation() {
        return { id: "cnv-email-approval", channel: "email", metadata: { accountKey: "info" } };
      },
    },
    aiWorkflowService: {
      async analyseConversation() {
        return { draft: { id: "draft-email-approval", requiresApproval: true } };
      },
    },
    governanceService: { async attemptAutonomousReply() { throw new Error("must not send"); } },
    notificationService: {
      async create(value) {
        notifications.push(value);
        return value;
      },
    },
  };

  const result = await runInboundConversationAutomation({ context, conversationId: "cnv-email-approval" });

  assert.equal(result.reason, "approval_required");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].title, "Email reply approval required");
  assert.equal(notifications[0].severity, "warning");
  assert.equal(notifications[0].emailRequested, false);
  assert.match(notifications[0].idempotencySeed, /draft-email-approval/);
});


test("inbound automation skips legacy Admin/Newsletter email conversations before AI or governance", async () => {
  for (const accountKey of ["admin", "newsletter"]) {
    let analysed = false;
    let sent = false;
    const context = {
      config: { aiEnabled: true, autonomousRepliesEnabled: true },
      repository: {
        async getConversation() {
          return { id: `cnv-${accountKey}`, channel: "email", metadata: { accountKey } };
        },
      },
      aiWorkflowService: { async analyseConversation() { analysed = true; } },
      governanceService: { async attemptAutonomousReply() { sent = true; } },
    };
    const result = await runInboundConversationAutomation({ context, conversationId: `cnv-${accountKey}` });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "email_account_outside_comms_hub_automation");
    assert.equal(result.accountKey, accountKey);
    assert.equal(analysed, false);
    assert.equal(sent, false);
  }
});


test("inbound automation failure is converted into a durable delayed retry", async () => {
  const scheduled = [];
  const context = {
    config: { aiEnabled: true, autonomousRepliesEnabled: true },
    aiWorkflowService: { async analyseConversation() { throw Object.assign(new Error("AI temporarily unavailable"), { code: "provider_timeout" }); } },
    governanceService: { async attemptAutonomousReply() { throw new Error("must not send"); } },
    operationsRepository: { async scheduleDelayedAction(value) { scheduled.push(value); return value; } },
  };
  const kicked = kickInboundConversationAutomation({ context, conversationId: "cnv-retry", actor: "email-inbound-automation", triggerMessageId: "msg-retry" });
  assert.equal(kicked, true);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].actionType, "recheck");
  assert.equal(scheduled[0].payload.inboundAutomationRetry, true);
  assert.equal(scheduled[0].payload.triggerMessageId, "msg-retry");
  assert.match(scheduled[0].idempotencyKey, /cnv-retry:msg-retry/);
});
