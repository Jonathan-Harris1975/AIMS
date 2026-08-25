import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { CommsHubSocialPollWorker } from "../services/comms-hub/workers/socialPollWorker.js";
import { CommsHubWebhookReconcileWorker } from "../services/comms-hub/workers/webhookReconcileWorker.js";
import { COMMS_HUB_REQUIRED_MIGRATIONS } from "../services/comms-hub/migrations/manifest.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("social polling passes the full runtime context into inbound automation", async () => {
  const analysed = [];
  const delivered = [];
  const persisted = [];
  const context = {
    config: {
      aiEnabled: true,
      autonomousRepliesEnabled: true,
      socialMonitorOnly: false,
      socialPollBatchSize: 25,
      socialPollMaxMessagePages: 1,
      socialPollOverlapMs: 15_000,
      zernioFamilies: {
        meta: { family: "meta", enabled: true, platforms: ["facebook"] },
      },
    },
    repository: {
      async persistZernioEvent(event) {
        persisted.push(event);
        return { duplicate: false };
      },
    },
    zernio: {
      meta: {
        async listConversations() {
          return {
            data: [{ id: "thread-1", accountId: "account-1", participantId: "person-1", participantName: "Reader" }],
            pagination: { hasMore: false },
          };
        },
        async listMessages() {
          return {
            messages: [{ id: "message-1", direction: "inbound", message: "Thanks, this was useful.", senderId: "person-1", senderName: "Reader" }],
            pagination: { hasMore: false },
          };
        },
      },
    },
    aiWorkflowService: {
      async analyseConversation(conversationId) {
        analysed.push(conversationId);
        return { draft: { id: "draft-1", requiresApproval: false } };
      },
    },
    governanceService: {
      async attemptAutonomousReply(input) {
        delivered.push(input);
        return { delivered: true };
      },
    },
  };

  const worker = new CommsHubSocialPollWorker({ context, writeLog: async () => {} });
  const result = await worker.pollConversationJob({ credential_family: "meta", platform: "facebook" }, context.zernio.meta, new Date().toISOString());
  await flush();
  await flush();

  assert.equal(result.processed, 1);
  assert.equal(persisted.length, 1);
  assert.equal(analysed.length, 1, "polled inbound message should reach AI workflow");
  assert.equal(delivered.length, 1, "eligible polled inbound message should reach governance delivery");
  assert.equal(analysed[0], persisted[0].conversationId);
});

test("webhook reconcile worker creates a missing enabled Zernio webhook", async () => {
  const created = [];
  const context = {
    config: {
      publicBaseUrl: "https://zeroth-kara-jonathanharris-3296ed37.koyeb.app",
      zernioWebhookReconcileEnabled: true,
      zernioWebhookReconcileIntervalMs: 900_000,
      zernioFamilies: {
        meta: {
          family: "meta",
          enabled: true,
          webhookSecret: "test-secret",
          webhookName: "AIMS Comms Hub Meta",
          platforms: ["facebook", "instagram"],
        },
        video: { family: "video", enabled: false, webhookSecret: "", webhookName: "AIMS Comms Hub Video", platforms: ["youtube"] },
      },
    },
    zernio: {
      meta: {
        async listWebhooks() { return { webhooks: [] }; },
        async createWebhook(payload) { created.push(payload); return { webhook: { id: "wh-1", ...payload } }; },
      },
    },
  };

  const worker = new CommsHubWebhookReconcileWorker({ context, writeLog: async () => {} });
  const result = await worker.runOnce();

  assert.equal(result.skipped, false);
  assert.equal(result.families.meta.operation, "created");
  assert.equal(created.length, 1);
  assert.equal(created[0].url, "https://zeroth-kara-jonathanharris-3296ed37.koyeb.app/comms-hub/intake/zernio/meta");
  assert.equal(created[0].secret, "test-secret");
  assert.equal(created[0].isActive, true);
});


test("webhook reconciliation isolates one Zernio family failure from the other family", async () => {
  const created = [];
  const context = {
    config: {
      publicBaseUrl: "https://zeroth-kara-jonathanharris-3296ed37.koyeb.app",
      zernioWebhookReconcileEnabled: true,
      zernioWebhookReconcileIntervalMs: 900_000,
      zernioFamilies: {
        meta: { family: "meta", enabled: true, webhookSecret: "meta-secret", webhookName: "AIMS Comms Hub Meta", platforms: ["facebook", "instagram"] },
        video: { family: "video", enabled: true, webhookSecret: "video-secret", webhookName: "AIMS Comms Hub Video", platforms: ["youtube"] },
      },
    },
    zernio: {
      meta: { async listWebhooks() { throw Object.assign(new Error("temporary meta outage"), { code: "meta_outage" }); } },
      video: {
        async listWebhooks() { return { webhooks: [] }; },
        async createWebhook(payload) { created.push(payload); return { webhook: { id: "video-wh", ...payload } }; },
      },
    },
  };
  const worker = new CommsHubWebhookReconcileWorker({ context, writeLog: async () => {} });
  const result = await worker.runOnce();
  assert.deepEqual(result.failed, ["meta"]);
  assert.deepEqual(result.succeeded, ["video"]);
  assert.equal(result.failures.meta.code, "meta_outage");
  assert.equal(result.families.video.operation, "created");
  assert.equal(created[0].url, "https://zeroth-kara-jonathanharris-3296ed37.koyeb.app/comms-hub/intake/zernio/video");
});

test("runtime reliability migration preserves strict default social policy and adds a narrow engagement policy", () => {
  const db = new DatabaseSync(":memory:");
  for (const name of COMMS_HUB_REQUIRED_MIGRATIONS) {
    db.exec(fs.readFileSync(new URL(`../services/comms-hub/migrations/${name}.sql`, import.meta.url), "utf8"));
  }
  const general = db.prepare("SELECT policy_key, require_evidence, minimum_confidence FROM comms_hub_autonomous_reply_policies WHERE policy_key='full-social-low-risk'").get();
  const engagement = db.prepare("SELECT policy_key, intent, require_evidence, minimum_confidence, status FROM comms_hub_autonomous_reply_policies WHERE policy_key='social-engagement-safe'").get();

  assert.equal(general.require_evidence, 1);
  assert.equal(Number(general.minimum_confidence), 0.94);
  assert.equal(engagement.policy_key, "social-engagement-safe");
  assert.equal(engagement.intent, "social_engagement");
  assert.equal(engagement.require_evidence, 0);
  assert.equal(Number(engagement.minimum_confidence), 0.9);
  assert.equal(engagement.status, "active");
});

test("runtime source contains bounded self-recovery and automatic webhook reconciliation", () => {
  const source = fs.readFileSync(new URL("../services/comms-hub/runtime.js", import.meta.url), "utf8");
  assert.match(source, /runtimeSupervisorEnabled/);
  assert.match(source, /runtimeSupervisorMaxRetryMs/);
  assert.match(source, /scheduleRuntimeSupervisorRetry/);
  assert.match(source, /webhookReconcileWorker\.start\(\)/);
  assert.match(source, /new CommsHubSocialPollWorker\(\{ context: active \}\)/);
  assert.doesNotMatch(source, /CommsHubWakeClient|wakeClient/);
});
