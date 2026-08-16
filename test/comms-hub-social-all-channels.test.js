import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SOCIAL_CHANNEL_CAPABILITIES,
  getCommsHubReadiness,
  loadCommsHubConfig,
} from "../services/comms-hub/config.js";
import { zernioWebhookEventsForFamily } from "../services/comms-hub/domain/zernioWebhook.js";
import { reconcileEnabledZernioWebhooks } from "../services/comms-hub/socialService.js";
import { executeSocialAction } from "../services/comms-hub/socialActionsService.js";
import { CommsHubSocialPollWorker } from "../services/comms-hub/workers/socialPollWorker.js";

function fullEnv() {
  return {
    COMMS_HUB_ENABLED: "true",
    D1_UUID: "d1-id",
    D1_API_KEY: "d1-token",
    JOTFORM_API_KEY: "jotform-key",
    R2_ENDPOINT: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
    R2_ACCESS_KEY_ID: "r2-key",
    R2_SECRET_ACCESS_KEY: "r2-secret",
    R2_BUCKET_COMMS_HUB: "comms-hub",
    COMMS_HUB_D1_PROXY_URL: "https://d1.example.test/query",
    COMMS_HUB_D1_PROXY_TOKEN: "proxy-token",
    COMMS_HUB_PUBLIC_BASE_URL: "https://aims.example.test",
    COMMS_HUB_ZERNIO_META_ENABLED: "true",
    COMMS_HUB_ZERNIO_VIDEO_ENABLED: "true",
    COMMS_HUB_ZERNIO_POLL_ENABLED: "true",
    COMMS_HUB_SOCIAL_MONITOR_ONLY: "true",
    ZERNIO_META_API_KEY: "meta-key",
    ZERNIO_META_WEBHOOK_SECRET: "meta-secret",
    ZERNIO_VIDEO_API_KEY: "video-key",
    ZERNIO_VIDEO_WEBHOOK_SECRET: "video-secret",
  };
}

test("three-channel capability matrix reflects the implemented Facebook, Instagram and YouTube contracts", () => {
  assert.deepEqual(Object.keys(SOCIAL_CHANNEL_CAPABILITIES).sort(), ["facebook", "instagram", "youtube"]);
  assert.equal(SOCIAL_CHANNEL_CAPABILITIES.facebook.family, "meta");
  assert.equal(SOCIAL_CHANNEL_CAPABILITIES.facebook.directMessages, true);
  assert.deepEqual(SOCIAL_CHANNEL_CAPABILITIES.facebook.pollingResources, ["conversations", "comments"]);
  assert.equal(SOCIAL_CHANNEL_CAPABILITIES.instagram.directMessages, true);
  assert.equal(SOCIAL_CHANNEL_CAPABILITIES.instagram.privateCommentReplies, true);
  assert.equal(SOCIAL_CHANNEL_CAPABILITIES.youtube.family, "video");
  assert.equal(SOCIAL_CHANNEL_CAPABILITIES.youtube.directMessages, false);
  assert.equal(SOCIAL_CHANNEL_CAPABILITIES.youtube.comments, true);
  assert.equal(SOCIAL_CHANNEL_CAPABILITIES.youtube.moderation, true);
  assert.equal(SOCIAL_CHANNEL_CAPABILITIES.youtube.liveChat, false);
  assert.deepEqual(SOCIAL_CHANNEL_CAPABILITIES.youtube.pollingResources, ["comments"]);
});

test("full social monitoring environment makes both credential families ready while writes remain blocked", () => {
  const env = fullEnv();
  const readiness = getCommsHubReadiness(env);
  assert.equal(readiness.ready, true);
  assert.equal(readiness.zernio.meta.status, "configured");
  assert.equal(readiness.zernio.video.status, "configured");
  const config = loadCommsHubConfig(env, { requireEnabled: true });
  assert.equal(config.socialMonitorOnly, true);
  assert.equal(config.socialPollWorkerEnabled, true);
  assert.deepEqual(config.zernioFamilies.meta.platforms, ["facebook", "instagram"]);
  assert.deepEqual(config.zernioFamilies.video.platforms, ["youtube"]);
});

test("webhook family contracts include Meta DMs/comments and YouTube comments without inventing YouTube DMs", () => {
  const meta = zernioWebhookEventsForFamily("meta");
  const video = zernioWebhookEventsForFamily("video");
  assert.equal(meta.includes("message.received"), true);
  assert.equal(meta.includes("comment.received"), true);
  assert.equal(video.includes("comment.received"), true);
  assert.equal(video.some((event) => event.startsWith("message.")), false);
});

test("poll worker can drain all five seeded monitoring resources across the three channels", async () => {
  const jobs = [
    ["poll_meta_facebook_conversations", "meta", "facebook", "conversations"],
    ["poll_meta_instagram_conversations", "meta", "instagram", "conversations"],
    ["poll_meta_facebook_comments", "meta", "facebook", "comments"],
    ["poll_meta_instagram_comments", "meta", "instagram", "comments"],
    ["poll_video_youtube_comments", "video", "youtube", "comments"],
  ].map(([id, credential_family, platform, resource]) => ({
    id, credential_family, platform, resource,
    cursor: null, cycle_started_at: null, last_success_at: null, attempts: 1,
  }));
  const calls = [];
  const completed = [];
  const repository = {
    async claimSocialPollJob() { return jobs.shift() || null; },
    async completeSocialPollJob(value) { completed.push(value); },
    async failSocialPollJob() { assert.fail("all-channel empty monitoring poll should not fail"); },
  };
  const client = (family) => ({
    async listConversations(value) {
      calls.push([family, "conversations", value.platform]);
      return { data: [], pagination: { hasMore: false, nextCursor: null } };
    },
    async listCommentedPosts(value) {
      calls.push([family, "comments", value.platform]);
      return { data: [], pagination: { hasMore: false, nextCursor: null } };
    },
  });
  const worker = new CommsHubSocialPollWorker({
    repository,
    zernio: { meta: client("meta"), video: client("video") },
    config: {
      socialMonitorOnly: true,
      zernioFamilies: {
        meta: { family: "meta", enabled: true, platforms: ["facebook", "instagram"] },
        video: { family: "video", enabled: true, platforms: ["youtube"] },
      },
      socialPollLeaseMs: 60_000,
      socialPollBatchSize: 25,
      socialPollMaxMessagePages: 5,
      socialPollMaxCommentPages: 5,
      socialPollOverlapMs: 7_200_000,
      socialPollMs: 120_000,
      socialPollWorkerEnabled: true,
    },
    writeLog: async () => {},
  });
  const result = await worker.runOnce({ limit: 10 });
  assert.equal(result.processedJobs, 5);
  assert.equal(completed.length, 5);
  assert.deepEqual(calls, [
    ["meta", "conversations", "facebook"],
    ["meta", "conversations", "instagram"],
    ["meta", "comments", "facebook"],
    ["meta", "comments", "instagram"],
    ["video", "comments", "youtube"],
  ]);
});

test("reconcile-all configures both enabled Zernio webhook families", async () => {
  const created = [];
  const makeClient = (family) => ({
    async listWebhooks() { return { webhooks: [] }; },
    async createWebhook(body) { created.push([family, body]); return { webhook: { id: `${family}-hook` } }; },
  });
  const context = {
    config: {
      publicBaseUrl: "https://aims.example.test",
      zernioFamilies: {
        meta: { family: "meta", enabled: true, webhookName: "AIMS Comms Hub Meta", webhookSecret: "meta-secret" },
        video: { family: "video", enabled: true, webhookName: "AIMS Comms Hub Video", webhookSecret: "video-secret" },
      },
    },
    zernio: { meta: makeClient("meta"), video: makeClient("video") },
  };
  const result = await reconcileEnabledZernioWebhooks({ context });
  assert.deepEqual(result.enabledFamilies, ["meta", "video"]);
  assert.equal(created.length, 2);
  assert.equal(created[0][1].url, "https://aims.example.test/comms-hub/intake/zernio/meta");
  assert.equal(created[0][1].events.includes("message.received"), true);
  assert.equal(created[0][1].events.includes("comment.received"), true);
  assert.equal(created[1][1].url, "https://aims.example.test/comms-hub/intake/zernio/video");
  assert.equal(created[1][1].events.includes("comment.received"), true);
  assert.equal(created[1][1].events.some((event) => event.startsWith("message.")), false);
});

test("capability gate rejects a corrupt YouTube DM thread before any provider send", async () => {
  let providerCalled = false;
  const context = {
    config: { socialMonitorOnly: false, aiEnabled: false, approvalsEnforced: false },
    repository: {
      async getConversation() { return { id: "cnv_01h00000000000000000000000", channel: "social_dm", status: "open" }; },
      async getSocialThreadByConversation() {
        return {
          credential_family: "video", platform: "youtube", thread_type: "dm",
          account_id: "yt-1", provider_thread_id: "thread-1", provider_post_id: null, root_comment_id: null,
        };
      },
      async claimOutboundAction() { return { acquired: true, duplicate: false, existing: null }; },
      async completeOutboundAction() {},
      async failOutboundAction() {},
    },
    operationsRepository: { async getConversationOperations() { return { operational_status: "open" }; } },
    zernio: { video: { async sendMessage() { providerCalled = true; return { success: true }; } } },
  };
  await assert.rejects(
    executeSocialAction({
      conversationId: "cnv_01h00000000000000000000000",
      action: "reply",
      body: { message: "No YouTube DM exists" },
      idempotencyKey: "youtube-dm-guard-001",
      context,
    }),
    (error) => error?.code === "social_dm_unsupported"
  );
  assert.equal(providerCalled, false);
});

test("full social monitoring deployment profile enables both families and leaves secrets blank", async () => {
  const source = await readFile(new URL("../config/comms-hub-social-monitoring.env.example", import.meta.url), "utf8");
  assert.match(source, /COMMS_HUB_ZERNIO_META_ENABLED=true/);
  assert.match(source, /COMMS_HUB_ZERNIO_VIDEO_ENABLED=true/);
  assert.match(source, /COMMS_HUB_ZERNIO_POLL_ENABLED=true/);
  assert.match(source, /COMMS_HUB_SOCIAL_MONITOR_ONLY=true/);
  assert.match(source, /ZERNIO_META_API_KEY=\n/);
  assert.match(source, /ZERNIO_VIDEO_API_KEY=\n/);
});
