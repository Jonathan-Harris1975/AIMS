import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { executeSocialAction, requestSocialActionApproval } from "../services/comms-hub/socialActionsService.js";
import { CommsHubSocialPollWorker } from "../services/comms-hub/workers/socialPollWorker.js";

test("social monitoring-only mode blocks all outbound actions before provider or repository mutation", async () => {
  const context = { config: { socialMonitorOnly: true } };
  await assert.rejects(
    executeSocialAction({
      conversationId: "cnv_meta_test",
      action: "reply",
      body: { message: "must not send" },
      idempotencyKey: "meta-monitor-001",
      context,
    }),
    (error) => error?.statusCode === 403 && error?.code === "social_monitor_only"
  );
  await assert.rejects(
    requestSocialActionApproval({
      conversationId: "cnv_meta_test",
      action: "hide",
      body: {},
      idempotencyKey: "meta-monitor-002",
      requestedBy: "test",
      context,
    }),
    (error) => error?.statusCode === 403 && error?.code === "social_monitor_only"
  );
});

test("Meta polling emits monitoring telemetry for Facebook and Instagram without outbound provider calls", async () => {
  const jobs = [
    {
      id: "poll_meta_facebook_conversations",
      credential_family: "meta",
      platform: "facebook",
      resource: "conversations",
      cursor: null,
      cycle_started_at: null,
      last_success_at: null,
      attempts: 1,
    },
    {
      id: "poll_meta_instagram_comments",
      credential_family: "meta",
      platform: "instagram",
      resource: "comments",
      cursor: null,
      cycle_started_at: null,
      last_success_at: null,
      attempts: 1,
    },
  ];
  const completed = [];
  const logs = [];
  const providerCalls = [];
  const repository = {
    async claimSocialPollJob() { return jobs.shift() || null; },
    async completeSocialPollJob(value) { completed.push(value); },
    async failSocialPollJob() { assert.fail("Meta monitoring poll should not fail"); },
  };
  const meta = {
    async listConversations(value) {
      providerCalls.push({ operation: "listConversations", value });
      return { data: [], pagination: { hasMore: false, nextCursor: null } };
    },
    async listCommentedPosts(value) {
      providerCalls.push({ operation: "listCommentedPosts", value });
      return { data: [], pagination: { hasMore: false, nextCursor: null } };
    },
  };
  const worker = new CommsHubSocialPollWorker({
    repository,
    zernio: { meta },
    config: {
      socialMonitorOnly: true,
      zernioFamilies: {
        meta: { family: "meta", enabled: true, platforms: ["facebook", "instagram"] },
        video: { family: "video", enabled: false, platforms: ["youtube"] },
      },
      socialPollLeaseMs: 60_000,
      socialPollBatchSize: 25,
      socialPollMaxMessagePages: 5,
      socialPollMaxCommentPages: 5,
      socialPollOverlapMs: 7_200_000,
      socialPollMs: 120_000,
      socialPollWorkerEnabled: true,
    },
    writeLog: async (level, event, data) => logs.push({ level, event, data }),
  });

  const result = await worker.runOnce({ limit: 5 });
  assert.equal(result.processedJobs, 2);
  assert.equal(result.ingested, 0);
  assert.equal(completed.length, 2);
  assert.deepEqual(providerCalls.map((call) => [call.operation, call.value.platform]), [
    ["listConversations", "facebook"],
    ["listCommentedPosts", "instagram"],
  ]);
  assert.equal(logs.some((entry) => entry.event === "commsHub.socialPoll.attempt" && entry.data.monitorOnly === true), true);
  assert.equal(logs.some((entry) => entry.event === "commsHub.socialPoll.claimed" && entry.data.platform === "facebook"), true);
  assert.equal(logs.some((entry) => entry.event === "commsHub.socialPoll.claimed" && entry.data.platform === "instagram"), true);
  assert.equal(logs.some((entry) => entry.event === "commsHub.socialPoll.conversations.listed" && entry.data.conversations === 0), true);
  assert.equal(logs.some((entry) => entry.event === "commsHub.socialPoll.commentPosts.listed" && entry.data.posts === 0), true);
  assert.equal(logs.some((entry) => entry.event === "commsHub.socialPoll.runComplete" && entry.data.processedJobs === 2), true);
});

test("deployment templates default social canaries to monitoring-only", async () => {
  for (const file of [".env.example", "env.template", "services/comms-hub/env.template", "config/production.defaults.env"]) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /COMMS_HUB_SOCIAL_MONITOR_ONLY=true/);
  }
});
