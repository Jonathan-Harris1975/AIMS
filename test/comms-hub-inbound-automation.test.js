import test from "node:test";
import assert from "node:assert/strict";
import { runInboundConversationAutomation } from "../services/comms-hub/inboundAutomationService.js";

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
