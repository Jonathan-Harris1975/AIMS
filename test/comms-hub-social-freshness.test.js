import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { persistPolledComments, persistPolledConversation } from "../services/comms-hub/socialService.js";
import { CommsHubSocialPollWorker } from "../services/comms-hub/workers/socialPollWorker.js";

function workerConfig() {
  return {
    socialMonitorOnly: true,
    socialPollLeaseMs: 60_000,
    socialPollBatchSize: 25,
    socialPollMaxMessagePages: 5,
    socialPollMaxCommentPages: 5,
    socialPollOverlapMs: 7_200_000,
    socialPollMs: 120_000,
    socialPollWorkerEnabled: true,
    zernioFamilies: {
      meta: { family: "meta", enabled: true, platforms: ["facebook", "instagram"] },
      video: { family: "video", enabled: true, platforms: ["youtube"] },
    },
  };
}

test("first social poll establishes a freshness floor without requesting provider history", async () => {
  const jobs = [{
    id: "poll_video_youtube_comments",
    credential_family: "video",
    platform: "youtube",
    resource: "comments",
    cursor: null,
    cycle_started_at: null,
    fresh_since_at: null,
    last_success_at: null,
    attempts: 1,
  }];
  const completions = [];
  const logs = [];
  const repository = {
    async claimSocialPollJob() { return jobs.shift() || null; },
    async completeSocialPollJob(value) { completions.push(value); },
    async failSocialPollJob() { assert.fail("baseline must not fail"); },
  };
  const video = {
    async listCommentedPosts() { assert.fail("baseline must not fetch historical YouTube posts/comments"); },
  };
  const worker = new CommsHubSocialPollWorker({
    repository,
    zernio: { video },
    config: workerConfig(),
    writeLog: async (level, event, data) => logs.push({ level, event, data }),
  });

  const result = await worker.runOnce({ limit: 2 });
  assert.equal(result.processedJobs, 1);
  assert.equal(result.ingested, 0);
  assert.equal(completions.length, 1);
  assert.ok(completions[0].freshSinceAt);
  assert.ok(completions[0].lastSuccessAt);
  assert.equal(logs.some((entry) => entry.event === "commsHub.socialPoll.baselined"), true);
});

test("Facebook and Instagram DM polling discards messages older than the freshness floor", async () => {
  for (const platform of ["facebook", "instagram"]) {
    const persisted = [];
    const context = {
      repository: {
        async persistZernioEvent(event) {
          persisted.push(event);
          return { duplicate: true };
        },
      },
    };
    const result = await persistPolledConversation({
      family: "meta",
      platform,
      conversation: { id: `thread-${platform}`, accountId: `account-${platform}` },
      freshSince: "2026-08-28T12:00:00.000Z",
      messages: [
        { id: `old-${platform}`, direction: "inbound", message: "Historical", createdAt: "2025-01-01T00:00:00.000Z" },
        { id: `fresh-${platform}`, direction: "inbound", message: "New message", createdAt: "2026-08-28T12:01:00.000Z" },
      ],
      context,
    });
    assert.equal(persisted.length, 1);
    assert.match(persisted[0].providerMessageId, new RegExp(`fresh-${platform}$`));
    assert.deepEqual(result, { processed: 0, duplicates: 1 });
  }
});

test("Facebook, Instagram and YouTube comment polling discards old comments even on returned posts", async () => {
  for (const [family, platform] of [["meta", "facebook"], ["meta", "instagram"], ["video", "youtube"]]) {
    const persisted = [];
    const context = {
      repository: {
        async persistZernioEvent(event) {
          persisted.push(event);
          return { duplicate: true };
        },
      },
    };
    const result = await persistPolledComments({
      family,
      platform,
      post: { id: `post-${platform}`, accountId: `account-${platform}`, createdTime: "2024-01-01T00:00:00.000Z" },
      freshSince: "2026-08-28T12:00:00.000Z",
      comments: [
        { id: `old-${platform}`, message: "Historical", createdTime: "2025-01-01T00:00:00.000Z", from: { id: "old-user" } },
        { id: `fresh-${platform}`, message: "New comment", createdTime: "2026-08-28T12:02:00.000Z", from: { id: "new-user" } },
      ],
      context,
    });
    assert.equal(persisted.length, 1);
    assert.match(persisted[0].providerMessageId, new RegExp(`fresh-${platform}$`));
    assert.deepEqual(result, { processed: 0, duplicates: 1 });
  }
});

test("poll overlap never crosses the original social freshness watermark", async () => {
  const requests = [];
  const worker = new CommsHubSocialPollWorker({
    repository: {},
    zernio: {},
    config: workerConfig(),
    writeLog: async () => {},
  });
  await worker.pollCommentJob({
    id: "poll_video_youtube_comments",
    credential_family: "video",
    platform: "youtube",
    resource: "comments",
    last_success_at: "2026-08-28T14:00:00.000Z",
    fresh_since_at: "2026-08-28T13:30:00.000Z",
  }, {
    async listCommentedPosts(value) {
      requests.push(value);
      return { data: [], pagination: { hasMore: false } };
    },
  }, "2026-08-28T14:01:00.000Z");
  assert.equal(requests[0].since, "2026-08-28T13:30:00.000Z");
});

test("migration 0017 archives stale poll-only imports, preserves live activity and resets poll watermarks", () => {
  const db = new DatabaseSync(":memory:");
  for (const name of [
    "0001_comms_hub.sql",
    "0002_zernio_social.sql",
    "0003_ai_workflows.sql",
    "0004_hardening.sql",
    "0005_operations_and_channels.sql",
  ]) {
    db.exec(readFileSync(new URL(`../services/comms-hub/migrations/${name}`, import.meta.url), "utf8"));
  }

  const now = "2026-08-28T12:00:00.000Z";
  const insertConversation = db.prepare(`INSERT INTO comms_hub_conversations
    (id, channel, provider, workflow, status, contact_id, subject, source_reference, created_at, updated_at, last_message_at, metadata_json)
    VALUES (?, 'social_comment', 'zernio', 'social_comment_moderation', 'open', ?, 'youtube comment', ?, ?, ?, ?, '{}')`);
  const insertContact = db.prepare(`INSERT INTO comms_hub_contacts (id, primary_email, display_name, phone, created_at, updated_at) VALUES (?, NULL, ?, NULL, ?, ?)`);
  const insertEvent = db.prepare(`INSERT INTO comms_hub_social_events
    (id, provider, credential_family, platform, provider_event_id, event_type, conversation_id, message_id, correlation_id, source, received_at, processed_at, payload_sha256, payload_json)
    VALUES (?, 'zernio', 'video', 'youtube', ?, 'comment.received', ?, NULL, ?, ?, ?, ?, 'hash', '{}')`);

  for (const key of ["stale", "fresh", "webhook"]) {
    insertContact.run(`cnt-${key}`, key, now, now);
    insertConversation.run(`cnv-${key}`, `cnt-${key}`, `source-${key}`, now, now, now);
  }
  db.prepare(`INSERT INTO comms_hub_conversation_operations (conversation_id, operational_status, version, updated_by, updated_at) VALUES ('cnv-stale','pending',1,'test',?)`).run(now);
  insertEvent.run("evt-stale", "provider-stale", "cnv-stale", "corr-stale", "poll", "2025-01-01T00:00:00.000Z", now);
  insertEvent.run("evt-fresh", "provider-fresh", "cnv-fresh", "corr-fresh", "poll", "2026-08-28T11:58:00.000Z", now);
  insertEvent.run("evt-webhook", "provider-webhook", "cnv-webhook", "corr-webhook", "webhook", "2025-01-01T00:00:00.000Z", now);

  db.exec(readFileSync(new URL("../services/comms-hub/migrations/0017_social_fresh_activity_only.sql", import.meta.url), "utf8"));

  assert.equal(db.prepare("SELECT operational_status FROM comms_hub_conversation_operations WHERE conversation_id = 'cnv-stale'").get().operational_status, "archived");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM comms_hub_conversation_operations WHERE conversation_id = 'cnv-fresh'").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM comms_hub_conversation_operations WHERE conversation_id = 'cnv-webhook'").get().count, 0);
  const poll = db.prepare("SELECT fresh_since_at, last_success_at, cursor FROM comms_hub_social_poll_jobs LIMIT 1").get();
  assert.equal(poll.fresh_since_at, null);
  assert.equal(poll.last_success_at, null);
  assert.equal(poll.cursor, null);
});
