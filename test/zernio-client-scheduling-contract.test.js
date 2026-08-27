import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const ORIGINAL_ENV = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
}

test.afterEach(restoreEnv);

test("Zernio create retries reuse one idempotency key and scheduled posts can be rolled back", async (t) => {
  const requestIds = [];
  let postAttempts = 0;
  let deleteAttempts = 0;
  const server = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/posts") {
      postAttempts += 1;
      requestIds.push(String(req.headers["x-request-id"] || ""));
      for await (const _chunk of req) {}
      if (postAttempts === 1) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "temporary outage" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ post: { _id: "post_rollback_1", status: "scheduled", scheduledFor: "2026-08-04T14:00" } }));
      return;
    }
    if (req.method === "DELETE" && req.url === "/posts/post_rollback_1") {
      deleteAttempts += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "Post deleted successfully" }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  process.env.ZERNIO_API_BASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.ZERNIO_API_RETRY_ATTEMPTS = "2";
  process.env.ZERNIO_API_RETRY_BASE_MS = "1";
  process.env.ZERNIO_API_RETRY_MAX_MS = "2";

  const { createPost, deletePost } = await import(`../services/zernio/utils/zernioClient.js?contract=${Date.now()}`);
  const body = {
    content: "AI scheduling contract",
    scheduledFor: "2026-08-04T14:00",
    timezone: "Europe/London",
    platforms: [{ platform: "facebook", accountId: "fb-1" }],
    mediaItems: [{ type: "image", url: "https://images.jonathan-harris.online/ai-contract" }],
  };
  const created = await createPost(body, "test-key");
  assert.equal(created.post.status, "scheduled");
  assert.equal(postAttempts, 2);
  assert.equal(requestIds.length, 2);
  assert.ok(requestIds[0].startsWith("aims-"));
  assert.equal(requestIds[0], requestIds[1]);
  assert.deepEqual(created._zernioRetry, { attempts: 2, recovered: true, operation: "POST posts" });

  const deleted = await deletePost("post_rollback_1", "test-key");
  assert.equal(deleted.ok, true);
  assert.equal(deleted.deleted, true);
  assert.equal(deleteAttempts, 1);
});

test("Zernio rollback treats an already-absent scheduled post as success", async (t) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  process.env.ZERNIO_API_BASE_URL = `http://127.0.0.1:${address.port}`;
  const { deletePost } = await import(`../services/zernio/utils/zernioClient.js?absent=${Date.now()}`);
  const deleted = await deletePost("post_already_gone", "test-key");
  assert.equal(deleted.ok, true);
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.alreadyAbsent, true);
});

test("Zernio slot seed keeps the provider request id stable when recovered schedule/body changes", async (t) => {
  const requestIds = [];
  const bodies = [];
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/posts") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || "{}");
    requestIds.push(String(req.headers["x-request-id"] || ""));
    bodies.push(body);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ post: { _id: `post_${requestIds.length}`, status: "scheduled", scheduledFor: body.scheduledFor } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  process.env.ZERNIO_API_BASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.ZERNIO_API_RETRY_ATTEMPTS = "1";
  const { createPost } = await import(`../services/zernio/utils/zernioClient.js?slot-seed=${Date.now()}`);
  const seed = "daily:thursday|2026-08-27 12:20|default|all";

  await createPost({ content: "first", scheduledFor: "2026-08-27T12:35", timezone: "Europe/London", platforms: [{ platform: "facebook", accountId: "fb-1" }] }, "test-key", { idempotencySeed: seed });
  await createPost({ content: "second", scheduledFor: "2026-08-27T12:52", timezone: "Europe/London", platforms: [{ platform: "facebook", accountId: "fb-1" }] }, "test-key", { idempotencySeed: seed });

  assert.equal(requestIds.length, 2);
  assert.equal(requestIds[0], requestIds[1]);
  assert.notEqual(bodies[0].scheduledFor, bodies[1].scheduledFor);
});
