import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";

import { getCommsHubReadiness, loadCommsHubConfig } from "../services/comms-hub/config.js";
import { ZernioInboxClient } from "../services/comms-hub/clients/zernioInboxClient.js";
import { readZernioWebhookEnvelope, normaliseZernioEvent, verifyZernioSignature } from "../services/comms-hub/domain/zernioWebhook.js";
import { CommsHubRepository } from "../services/comms-hub/repositories/commsRepository.js";
import { executeSocialAction } from "../services/comms-hub/socialActionsService.js";
import { persistPolledComments, persistPolledConversation, reconcileZernioWebhook, withZernioAcceptanceDeadline } from "../services/comms-hub/socialService.js";
import { CommsHubSocialPollWorker } from "../services/comms-hub/workers/socialPollWorker.js";
import { isPublicCommsHubIntakePath, requireAimsBearerAuth } from "../services/shared/middleware/suiteAuth.js";
import dataPlaneWorker, { validateStatement } from "../workers/comms-hub-data-plane/worker.js";

function baseEnv() {
  return {
    COMMS_HUB_ENABLED: "true",
    D1_UUID: "database-id",
    D1_API_KEY: "d1-token",
    JOTFORM_API_KEY: "jotform-token",
    R2_ENDPOINT: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
    R2_ACCESS_KEY_ID: "r2-access",
    R2_SECRET_ACCESS_KEY: "r2-secret",
    R2_BUCKET_COMMS_HUB: "comms-hub",
    R2_PUBLIC_BASE_URL_COMMS_HUB: "https://example.r2.dev",
  };
}

function signedRequest(payload, secret) {
  const raw = Buffer.from(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(raw).digest("hex");
  return {
    aimsRawBody: raw,
    headers: { "x-zernio-signature": signature, "x-zernio-event-id": payload.id },
    get(name) { return this.headers[String(name).toLowerCase()] || ""; },
  };
}

class SqliteD1 {
  constructor() {
    this.db = new DatabaseSync(":memory:");
    for (const migration of [
      "0001_comms_hub.sql",
      "0002_zernio_social.sql",
      "0003_ai_workflows.sql",
      "0004_hardening.sql",
      "0005_operations_and_channels.sql",
      "0006_smart_response_forms.sql",
      "0007_business_hours_and_handoff.sql",
    ]) {
      this.db.exec(readFileSync(new URL(`../services/comms-hub/migrations/${migration}`, import.meta.url), "utf8"));
    }
  }

  query(sql, params = []) {
    const statement = this.db.prepare(sql);
    return { success: true, results: statement.all(...params) };
  }

  batch(statements) {
    this.db.exec("BEGIN");
    try {
      const results = statements.map(({ sql, params = [] }) => this.query(sql, params));
      this.db.exec("COMMIT");
      return results;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}


test("Zernio webhook acceptance has a hard deadline below the provider acknowledgement window", async () => {
  const env = {
    ...baseEnv(),
    COMMS_HUB_ZERNIO_ACK_TIMEOUT_MS: "4000",
  };
  assert.equal(loadCommsHubConfig(env, { requireEnabled: true }).zernioAckTimeoutMs, 4000);
  assert.throws(
    () => loadCommsHubConfig({ ...env, COMMS_HUB_ZERNIO_ACK_TIMEOUT_MS: "5000" }, { requireEnabled: true }),
    /between 500 and 4500/
  );

  await assert.rejects(
    withZernioAcceptanceDeadline(new Promise(() => {}), 5),
    (error) => error?.code === "zernio_ack_deadline_exceeded" && error?.retryable === true
  );
  assert.equal(await withZernioAcceptanceDeadline(Promise.resolve("accepted"), 100), "accepted");
});

test("Zernio Meta and Video readiness are independent and require separate secrets", () => {
  const env = {
    ...baseEnv(),
    COMMS_HUB_ZERNIO_META_ENABLED: "true",
    COMMS_HUB_ZERNIO_VIDEO_ENABLED: "true",
    ZERNIO_META_API_KEY: "meta-key",
    ZERNIO_VIDEO_API_KEY: "video-key",
    ZERNIO_META_WEBHOOK_SECRET: "meta-hook",
    COMMS_HUB_PUBLIC_BASE_URL: "https://aims.example.com",
    COMMS_HUB_D1_PROXY_URL: "https://worker.example.com/query",
    COMMS_HUB_D1_PROXY_TOKEN: "proxy-token",
  };
  const readiness = getCommsHubReadiness(env);
  assert.equal(readiness.zernio.meta.ready, true);
  assert.equal(readiness.zernio.video.ready, false);
  assert.deepEqual(readiness.zernio.video.missing, ["ZERNIO_VIDEO_WEBHOOK_SECRET"]);
  assert.equal(readiness.missing.includes("ZERNIO_META_API_KEY"), false);
});

test("Zernio clients never fall back across the Meta and Video keys", async () => {
  const calls = [];
  const env = {
    ...baseEnv(),
    COMMS_HUB_ZERNIO_META_ENABLED: "true",
    COMMS_HUB_ZERNIO_VIDEO_ENABLED: "true",
    ZERNIO_META_API_KEY: "meta-key",
    ZERNIO_VIDEO_API_KEY: "video-key",
    ZERNIO_META_WEBHOOK_SECRET: "meta-hook",
    ZERNIO_VIDEO_WEBHOOK_SECRET: "video-hook",
    COMMS_HUB_PUBLIC_BASE_URL: "https://aims.example.com",
    COMMS_HUB_D1_PROXY_URL: "https://worker.example.com/query",
    COMMS_HUB_D1_PROXY_TOKEN: "proxy-token",
  };
  const config = loadCommsHubConfig(env, { requireEnabled: true });
  const fetchImpl = async (url, init) => {
    calls.push({ url, auth: init.headers.authorization });
    return new Response(JSON.stringify({ data: [], pagination: { hasMore: false } }), { status: 200 });
  };
  const meta = new ZernioInboxClient(config, "meta", { fetchImpl });
  const video = new ZernioInboxClient(config, "video", { fetchImpl });
  await meta.listConversations({ platform: "facebook" });
  await video.listCommentedPosts({ platform: "youtube" });
  assert.deepEqual(calls.map((call) => call.auth), ["Bearer meta-key", "Bearer video-key"]);
  assert.throws(() => meta.listCommentedPosts({ platform: "youtube" }), /does not belong to the meta API key/);
  assert.throws(() => video.listCommentedPosts({ platform: "instagram" }), /does not belong to the video API key/);
});


test("Meta hide and unhide use Zernio's distinct HTTP contracts", async () => {
  const calls = [];
  const config = loadCommsHubConfig({
    ...baseEnv(),
    COMMS_HUB_ZERNIO_META_ENABLED: "true",
    ZERNIO_META_API_KEY: "meta-key",
    ZERNIO_META_WEBHOOK_SECRET: "meta-hook",
    COMMS_HUB_PUBLIC_BASE_URL: "https://aims.example.com",
    COMMS_HUB_D1_PROXY_URL: "https://worker.example.com/query",
    COMMS_HUB_D1_PROXY_TOKEN: "proxy-token",
  }, { requireEnabled: true });
  const client = new ZernioInboxClient(config, "meta", {
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init.method, body: init.body || null });
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    },
  });

  await client.setCommentHidden({ platform: "facebook", postId: "post-1", commentId: "comment-1", accountId: "page-1", hidden: true });
  await client.setCommentHidden({ platform: "facebook", postId: "post-1", commentId: "comment-1", accountId: "page-1", hidden: false });

  assert.equal(calls[0].method, "POST");
  assert.match(calls[0].url, /\/inbox\/comments\/post-1\/comment-1\/hide$/);
  assert.deepEqual(JSON.parse(calls[0].body), { accountId: "page-1" });
  assert.equal(calls[1].method, "DELETE");
  assert.match(calls[1].url, /\/inbox\/comments\/post-1\/comment-1\/hide\?accountId=page-1$/);
  assert.equal(calls[1].body, null);
});


test("Only the exact Meta and Video POST endpoints bypass suite bearer auth", () => {
  const request = (method, url) => ({ method, originalUrl: url, url, headers: {}, get() { return ""; } });
  assert.equal(isPublicCommsHubIntakePath(request("POST", "/comms-hub/intake/zernio/meta")), true);
  assert.equal(isPublicCommsHubIntakePath(request("POST", "/comms-hub/intake/zernio/video")), true);
  assert.equal(isPublicCommsHubIntakePath(request("GET", "/comms-hub/intake/zernio/meta")), false);
  assert.equal(isPublicCommsHubIntakePath(request("POST", "/comms-hub/intake/zernio/other")), false);

  const meta = request("POST", "/comms-hub/intake/zernio/meta");
  let passed = false;
  requireAimsBearerAuth(meta, {}, () => { passed = true; });
  assert.equal(passed, true);
  assert.equal(meta.aimsAuth.strategy, "zernio-hmac-sha256");
});

test("Zernio webhook signatures use HMAC-SHA256 over the exact raw body", () => {
  const raw = Buffer.from('{"id":"evt-1"}');
  const expected = createHmac("sha256", "secret").update(raw).digest("hex");
  assert.equal(verifyZernioSignature(raw, expected, "secret"), true);
  assert.equal(verifyZernioSignature(Buffer.from('{"id":"evt-2"}'), expected, "secret"), false);
});

test("Meta webhook rejects a YouTube payload even when the signature is valid", () => {
  const payload = {
    id: "evt-wrong-family",
    event: "comment.received",
    timestamp: "2026-07-31T00:00:00.000Z",
    account: { accountId: "yt-account", platform: "youtube" },
    post: { id: "video-1", platform: "youtube" },
    comment: { id: "comment-1", message: "Hello", from: { id: "viewer-1" } },
  };
  assert.throws(
    () => readZernioWebhookEnvelope(signedRequest(payload, "meta-secret"), {
      family: "meta", secret: "meta-secret", maxBytes: 1_048_576,
    }),
    /does not belong to the meta API key/
  );
});

test("Meta DM event normalises to deterministic Comms Hub identities", () => {
  const payload = {
    id: "evt-meta-message-1",
    event: "message.received",
    timestamp: "2026-07-31T00:01:00.000Z",
    account: { accountId: "fb-page-1", platform: "facebook" },
    conversation: {
      id: "fb-conversation-1",
      platformConversationId: "fb-conversation-1",
      platform: "facebook",
      participantId: "person-1",
      participantName: "Jane",
    },
    message: {
      id: "fb-message-1",
      platformMessageId: "fb-message-1",
      text: "Can you help?",
      sender: { id: "person-1", name: "Jane" },
      createdAt: "2026-07-31T00:01:00.000Z",
    },
  };
  const envelope = readZernioWebhookEnvelope(signedRequest(payload, "meta-secret"), {
    family: "meta", secret: "meta-secret", maxBytes: 1_048_576,
  });
  const event = normaliseZernioEvent(envelope, { correlationId: "corr-1" });
  assert.equal(event.kind, "message");
  assert.equal(event.family, "meta");
  assert.equal(event.platform, "facebook");
  assert.equal(event.identity.participantId, "person-1");
  assert.match(event.conversationId, /^cnv_[0-9a-hjkmnp-tv-z]{26}$/);
  assert.equal(event.providerMessageId, "zernio:meta:facebook:fb-page-1:fb-message-1");
});

test("Video webhook accepts YouTube comments and creates a comment thread", () => {
  const payload = {
    id: "evt-video-comment-1",
    event: "comment.received",
    timestamp: "2026-07-31T00:02:00.000Z",
    account: { accountId: "yt-channel-1", platform: "youtube" },
    post: { id: "video-1", platformPostId: "video-1", platform: "youtube" },
    comment: {
      id: "yt-comment-1",
      platformCommentId: "yt-comment-1",
      platformPostId: "video-1",
      message: "Useful episode",
      from: { id: "viewer-1", name: "Viewer" },
    },
  };
  const envelope = readZernioWebhookEnvelope(signedRequest(payload, "video-secret"), {
    family: "video", secret: "video-secret", maxBytes: 1_048_576,
  });
  const event = normaliseZernioEvent(envelope, { correlationId: "corr-2" });
  assert.equal(event.kind, "comment");
  assert.equal(event.threadType, "comment");
  assert.equal(event.providerPostId, "video-1");
  assert.equal(event.rootCommentId, "yt-comment-1");
});

test("Social repository persists and deduplicates a verified Meta message transactionally", async () => {
  const d1 = new SqliteD1();
  const repository = new CommsHubRepository(d1);
  const payload = {
    id: "evt-repo-1",
    event: "message.received",
    timestamp: "2026-07-31T00:03:00.000Z",
    account: { accountId: "ig-account-1", platform: "instagram" },
    conversation: { id: "ig-thread-1", platform: "instagram", participantId: "ig-user-1", participantName: "Alex" },
    message: { id: "ig-message-1", text: "Hello", sender: { id: "ig-user-1", name: "Alex" } },
  };
  const envelope = readZernioWebhookEnvelope(signedRequest(payload, "meta-secret"), {
    family: "meta", secret: "meta-secret", maxBytes: 1_048_576,
  });
  const event = normaliseZernioEvent(envelope, { correlationId: "corr-repo" });
  assert.deepEqual(await repository.persistZernioEvent(event), { duplicate: false });
  assert.deepEqual(await repository.persistZernioEvent(event), { duplicate: true });
  const conversation = await repository.getConversation(event.conversationId);
  assert.equal(conversation.socialThread.credential_family, "meta");
  assert.equal(conversation.messages.length, 1);
  assert.equal(conversation.messages[0].body_text, "Hello");
});


test("Out-of-order message lifecycle events are retained without violating message foreign keys", async () => {
  const d1 = new SqliteD1();
  const repository = new CommsHubRepository(d1);
  const payload = {
    id: "evt-meta-read-before-message",
    event: "message.read",
    timestamp: "2026-07-31T00:04:00.000Z",
    account: { accountId: "fb-page-1", platform: "facebook" },
    conversation: {
      id: "fb-thread-lifecycle-1",
      platform: "facebook",
      participantId: "person-lifecycle-1",
      participantName: "Reader",
    },
    message: {
      id: "fb-message-lifecycle-1",
      platformMessageId: "fb-message-lifecycle-1",
      conversationId: "fb-thread-lifecycle-1",
      deliveryStatus: "read",
    },
  };
  const envelope = readZernioWebhookEnvelope(signedRequest(payload, "meta-secret"), {
    family: "meta", secret: "meta-secret", maxBytes: 1_048_576,
  });
  const event = normaliseZernioEvent(envelope, { correlationId: "corr-lifecycle" });
  assert.equal(event.kind, "message_status");
  assert.deepEqual(await repository.persistZernioEvent(event), { duplicate: false });
  const rows = d1.query("SELECT message_id, event_type FROM comms_hub_social_events WHERE provider_event_id = ?", [payload.id]).results;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].message_id, null);
  assert.equal(rows[0].event_type, "message.read");
});

test("Polling refreshes existing comment text and state instead of leaving stale records", async () => {
  const d1 = new SqliteD1();
  const repository = new CommsHubRepository(d1);
  const common = {
    family: "video",
    platform: "youtube",
    post: { id: "video-refresh", accountId: "channel-refresh" },
    context: { repository },
  };
  await persistPolledComments({
    ...common,
    comments: [{ id: "comment-refresh", message: "First text", createdTime: "2026-07-31T00:00:00.000Z", from: { id: "viewer-refresh" }, isHidden: false }],
  });
  await persistPolledComments({
    ...common,
    comments: [{ id: "comment-refresh", message: "Corrected text", createdTime: "2026-07-31T00:00:00.000Z", from: { id: "viewer-refresh" }, isHidden: true }],
  });
  const rows = d1.query("SELECT body_text, metadata_json FROM comms_hub_messages").results;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].body_text, "Corrected text");
  assert.equal(JSON.parse(rows[0].metadata_json).isHidden, true);
  assert.equal(d1.query("SELECT COUNT(*) AS count FROM comms_hub_social_events").results[0].count, 2);
});

test("Polling can retain a deleted-message tombstone when the original webhook was missed", async () => {
  const d1 = new SqliteD1();
  const repository = new CommsHubRepository(d1);
  const result = await persistPolledConversation({
    family: "meta",
    platform: "facebook",
    conversation: {
      id: "thread-deleted",
      accountId: "page-deleted",
      participantId: "person-deleted",
      participantName: "Deleted sender",
      status: "active",
    },
    messages: [{
      id: "message-deleted",
      conversationId: "thread-deleted",
      accountId: "page-deleted",
      platform: "facebook",
      direction: "incoming",
      message: "",
      isDeleted: true,
      deletedAt: "2026-07-31T00:15:00.000Z",
      createdAt: "2026-07-31T00:10:00.000Z",
    }],
    context: { repository },
  });
  assert.equal(result.processed, 1);
  const message = d1.query("SELECT body_text, metadata_json FROM comms_hub_messages").results[0];
  assert.equal(message.body_text, "[message deleted]");
  assert.equal(JSON.parse(message.metadata_json).deleted, true);
  const event = d1.query("SELECT event_type, message_id FROM comms_hub_social_events").results[0];
  assert.equal(event.event_type, "message.deleted");
  assert.ok(event.message_id);
});


test("Polling ignores Zernio historical records with no visible message content", async () => {
  const d1 = new SqliteD1();
  const repository = new CommsHubRepository(d1);
  const result = await persistPolledConversation({
    family: "meta",
    platform: "facebook",
    conversation: {
      id: "thread-empty-record",
      accountId: "page-empty-record",
      participantId: "person-empty-record",
      participantName: "Historical sender",
      status: "active",
    },
    messages: [{
      id: "message-empty-record",
      conversationId: "thread-empty-record",
      accountId: "page-empty-record",
      platform: "facebook",
      direction: "incoming",
      message: "",
      attachments: [],
      deliveryStatus: null,
      createdAt: "2026-07-31T00:10:00.000Z",
    }],
    context: { repository },
  });
  assert.deepEqual(result, { processed: 0, duplicates: 0 });
  assert.equal(d1.query("SELECT COUNT(*) AS count FROM comms_hub_messages").results[0].count, 0);
  assert.equal(d1.query("SELECT COUNT(*) AS count FROM comms_hub_social_events").results[0].count, 0);
});


test("Social migration prevents cross-family poll job collisions", () => {
  const d1 = new SqliteD1();
  const rows = d1.query("SELECT credential_family, platform, resource FROM comms_hub_social_poll_jobs ORDER BY id").results;
  assert.equal(rows.length, 5);
  assert.ok(rows.some((row) => row.credential_family === "meta" && row.platform === "facebook" && row.resource === "conversations"));
  assert.ok(rows.some((row) => row.credential_family === "video" && row.platform === "youtube" && row.resource === "comments"));
});

test("Uncertain outbound actions require reconciliation instead of blind retry", async () => {
  const repository = new CommsHubRepository(new SqliteD1());
  const now = "2026-07-31T00:20:00.000Z";
  const envelope = readZernioWebhookEnvelope(signedRequest({
    id: "evt-outbound-thread",
    event: "message.received",
    timestamp: now,
    account: { accountId: "meta-account", platform: "facebook" },
    conversation: { id: "fb-thread-outbound", platform: "facebook", accountId: "meta-account", participantId: "person-outbound" },
    message: { id: "fb-message-outbound", conversationId: "fb-thread-outbound", platform: "facebook", accountId: "meta-account", text: "Hello", direction: "incoming", sender: {
       id: "person-outbound", name: "Person" } },
  }, "meta-hook"), { family: "meta", secret: "meta-hook", maxBytes: 100_000 });
  const event = normaliseZernioEvent(envelope, { correlationId: "corr-outbound", source: "webhook" });
  await repository.persistZernioEvent(event);

  const claim = {
    id: "action-outbound-1",
    idempotencyKey: "outbound:test:1",
    conversationId: event.conversationId,
    family: "meta",
    platform: "facebook",
    actionType: "reply",
    requestSha256: "a".repeat(64),
    now,
  };
  assert.equal((await repository.claimOutboundAction(claim)).acquired, true);
  await repository.failOutboundAction({
    idempotencyKey: claim.idempotencyKey,
    failureClass: "temporary",
    errorMessage: "provider result unknown",
    failedAt: now,
    reconciliationRequired: true,
  });
  await assert.rejects(
    repository.claimOutboundAction({ ...claim, now: "2026-07-31T00:21:00.000Z" }),
    (error) => error?.code === "social_action_reconciliation_required"
  );
  const row = repository.d1.query(
    "SELECT status, attempts FROM comms_hub_social_outbound_actions WHERE idempotency_key = ?",
    [claim.idempotencyKey]
  ).results[0];
  assert.deepEqual({ ...row }, { status: "reconciliation_required", attempts: 1 });
});

test("DM reply uses the Meta client selected by the persisted thread family", async () => {
  const calls = [];
  const repository = {
    async getSocialThreadByConversation() {
      return {
        credential_family: "meta", platform: "facebook", thread_type: "dm",
        account_id: "page-1", provider_thread_id: "thread-1",
      };
    },
    async claimOutboundAction() { return { acquired: true, duplicate: false }; },
    async completeOutboundAction(value) { calls.push({ complete: value }); },
    async failOutboundAction() {},
  };
  repository.getConversation = async () => ({ id: "cnv_0123456789abcdefghjkmnpqrs", channel: "social_dm", status: "open" });
  const context = {
    repository,
    operationsRepository: { async getConversationOperations() { return { operational_status: "open" }; } },
    zernio: {
      meta: { async sendMessage(value) { calls.push({ send: value }); return { success: true, messageId: "message-1" }; } },
      video: { async sendMessage() { throw new Error("video key must not be used"); } },
    },
  };
  const result = await executeSocialAction({
    conversationId: "cnv_0123456789abcdefghjkmnpqrs",
    action: "reply",
    body: { message: "Thanks for getting in touch." },
    idempotencyKey: "reply:facebook:1",
    context,
  });
  assert.equal(result.duplicate, false);
  assert.equal(calls[0].send.platform, "facebook");
  assert.equal(calls[0].send.accountId, "page-1");
});

test("YouTube moderation uses the Video client and rejects banAuthor without rejection", async () => {
  const repository = {
    async getSocialThreadByConversation() {
      return {
        credential_family: "video", platform: "youtube", thread_type: "comment",
        account_id: "channel-1", provider_post_id: "video-1", root_comment_id: "comment-1",
      };
    },
    async claimOutboundAction() { return { acquired: true, duplicate: false }; },
    async completeOutboundAction() {},
    async failOutboundAction() {},
    async setConversationStatus() {},
  };
  const context = { repository, zernio: { video: { async moderateYouTubeComment() { return { success: true }; } } } };
  await assert.rejects(() => executeSocialAction({
    conversationId: "cnv_0123456789abcdefghjkmnpqrs",
    action: "moderate",
    body: { moderationStatus: "published", banAuthor: true },
    idempotencyKey: "moderate:youtube:1",
    context,
  }), /banAuthor is valid only/);
});

test("Social polling worker claims only enabled credential families", async () => {
  const claims = [];
  let claimCount = 0;
  const repository = {
    async claimSocialPollJob(value) {
      claims.push(value);
      if (claimCount++ > 0) return null;
      return {
        id: "poll-meta-facebook-conversations",
        credential_family: "meta",
        platform: "facebook",
        resource: "conversations",
        cursor: null,
        cycle_started_at: null,
        last_success_at: null,
        attempts: 1,
      };
    },
    async persistZernioEvent() { return { duplicate: false }; },
    async completeSocialPollJob() {},
    async failSocialPollJob() {},
  };
  const meta = {
    async listConversations() { return { data: [], pagination: { hasMore: false } }; },
  };
  const worker = new CommsHubSocialPollWorker({
    repository,
    zernio: { meta },
    config: {
      zernioFamilies: { meta: { family: "meta", enabled: true }, video: { family: "video", enabled: false } },
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
  const result = await worker.runOnce({ limit: 2 });
  assert.equal(result.processedJobs, 1);
  assert.deepEqual(claims[0].families, ["meta"]);
});


test("Video polling consumes Zernio data/comments response keys and persists an opaque cursor cycle", async () => {
  const d1 = new SqliteD1();
  const storedRepository = new CommsHubRepository(d1);
  let claims = 0;
  const completions = [];
  const repository = {
    persistZernioEvent: (...args) => storedRepository.persistZernioEvent(...args),
    async claimSocialPollJob() {
      if (claims++ > 0) return null;
      return {
        id: "poll-video-youtube-comments",
        credential_family: "video",
        platform: "youtube",
        resource: "comments",
        cursor: "opaque-post-cursor",
        cycle_started_at: "2026-07-31T00:00:00.000Z",
        last_success_at: "2026-07-30T23:00:00.000Z",
        attempts: 1,
      };
    },
    async completeSocialPollJob(value) { completions.push(value); },
    async failSocialPollJob() { throw new Error("poll must not fail"); },
  };
  const requests = [];
  const video = {
    async listCommentedPosts(value) {
      requests.push({ operation: "posts", value });
      return {
        data: [{ id: "video-42", accountId: "channel-42", accountUsername: "channel" }],
        pagination: { hasMore: false, nextCursor: null },
      };
    },
    async listPostComments(value) {
      requests.push({ operation: "comments", value });
      return {
        comments: [{
          id: "comment-42",
          message: "Useful",
          createdTime: "2026-07-31T00:10:00.000Z",
          from: { id: "viewer-42", name: "Viewer" },
          platform: "youtube",
          replies: [],
        }],
        pagination: { hasMore: false, cursor: "opaque-comment-cursor" },
      };
    },
  };
  const worker = new CommsHubSocialPollWorker({
    repository,
    zernio: { video },
    config: {
      zernioFamilies: { meta: { family: "meta", enabled: false }, video: { family: "video", enabled: true } },
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

  const result = await worker.runOnce({ limit: 2 });
  assert.equal(result.ingested, 1);
  assert.equal(requests[0].value.cursor, "opaque-post-cursor");
  assert.equal(requests[1].value.postId, "video-42");
  assert.equal(completions[0].cursor, null);
  assert.equal(completions[0].cycleStartedAt, null);
  const events = d1.query("SELECT credential_family, platform, event_type FROM comms_hub_social_events").results
    .map((row) => ({ ...row }));
  assert.deepEqual(events, [{ credential_family: "video", platform: "youtube", event_type: "comment.received" }]);
});


test("Webhook reconciliation always reapplies the family secret for safe rotation", async () => {
  const updates = [];
  const context = {
    config: {
      publicBaseUrl: "https://aims.example.com",
      zernioFamilies: {
        meta: {
          enabled: true,
          webhookName: "AIMS Comms Hub Meta",
          webhookSecret: "rotated-meta-secret",
        },
      },
    },
    zernio: {
      meta: {
        async listWebhooks() {
          return {
            webhooks: [{
              _id: "webhook-meta-1",
              name: "AIMS Comms Hub Meta",
              url: "https://aims.example.com/comms-hub/intake/zernio/meta",
              events: [
                "message.received", "message.sent", "message.edited", "message.deleted",
                "message.delivered", "message.read", "message.failed", "conversation.started",
                "comment.received", "account.connected", "account.disconnected",
              ],
              isActive: true,
            }],
          };
        },
        async updateWebhook(value) {
          updates.push(value);
          return { webhook: { ...value } };
        },
      },
    },
  };

  const result = await reconcileZernioWebhook({ family: "meta", context });
  assert.equal(result.operation, "updated");
  assert.equal(updates.length, 1);
  assert.equal(updates[0]._id, "webhook-meta-1");
  assert.equal(updates[0].secret, "rotated-meta-secret");
  assert.equal(updates[0].events.includes("message.failed"), true);
});

test("D1 data-plane statement validation rejects DDL and SQL stacking", () => {
  assert.throws(() => validateStatement({ sql: "DROP TABLE comms_hub_contacts" }), /Only runtime SELECT/);
  assert.throws(() => validateStatement({ sql: "SELECT 1; DROP TABLE x", params: [] }), /Multiple SQL statements/);
  assert.deepEqual(validateStatement({ sql: "SELECT ?", params: [1] }), { sql: "SELECT ?", params: [1] });
});

test("D1 data-plane requires the exact proxy token and returns Cloudflare-compatible results", async () => {
  const db = {
    prepare(sql) {
      return {
        bind(...params) {
          return { async all() { return { results: [{ sql, params }], meta: { rows_read: 1 } }; } };
        },
      };
    },
    async batch() { return []; },
  };
  const unauthorized = await dataPlaneWorker.fetch(new Request("https://worker.example/query", {
    method: "POST",
    headers: { authorization: "Bearer wrong", "content-type": "application/json" },
    body: JSON.stringify({ sql: "SELECT 1", params: [] }),
  }), { COMMS_HUB_DB: db, COMMS_HUB_D1_PROXY_TOKEN: "correct" });
  assert.equal(unauthorized.status, 401);

  const response = await dataPlaneWorker.fetch(new Request("https://worker.example/query", {
    method: "POST",
    headers: { authorization: "Bearer correct", "content-type": "application/json" },
    body: JSON.stringify({ sql: "SELECT ?", params: [7] }),
  }), { COMMS_HUB_DB: db, COMMS_HUB_D1_PROXY_TOKEN: "correct" });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.deepEqual(payload.result[0].results[0].params, [7]);
});
