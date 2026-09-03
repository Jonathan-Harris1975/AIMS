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

test("Zernio reconciles a documented 409 duplicate only after verifying the existing post", async (t) => {
  const postBodies = [];
  const existingPost = {
    _id: "post_existing_409",
    status: "scheduled",
    scheduledFor: "2027-01-01T12:00:00",
    content: "The same generated post is already queued.",
    mediaItems: [{ type: "image", url: "https://images.jonathan-harris.online/zernio/generated.png" }],
    platforms: [
      { platform: "facebook", accountId: { _id: "fb-page-1" } },
      { platform: "instagram", accountId: { _id: "ig-account-1" } },
    ],
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/profiles") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ profiles: [{ _id: "profile-1", name: "General" }] }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/accounts") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ accounts: [
        { _id: "fb-page-1", platform: "facebook", isActive: true },
        { _id: "ig-account-1", platform: "instagram", isActive: true },
      ] }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/accounts/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ accounts: [
        { _id: "fb-page-1", platform: "facebook", canPost: true },
        { _id: "ig-account-1", platform: "instagram", canPost: true },
      ] }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/posts") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ posts: [] }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/posts/post_existing_409") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ post: existingPost }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/posts") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      postBodies.push(JSON.parse(raw || "{}"));
      res.writeHead(409, { "content-type": "application/json" });
      res.end(JSON.stringify({
        error: "This exact content is already scheduled.",
        details: { accountId: "fb-page-1", platform: "facebook", existingPostId: existingPost._id },
      }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  process.env.ZERNIO_API_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ZERNIO_REQUIRED_PLATFORMS = "facebook,instagram";
  process.env.ZERNIO_VALIDATE_TARGET_ACCOUNTS = "true";
  process.env.ZERNIO_REQUIRE_SCHEDULE_CONFIRMATION = "true";
  process.env.ZERNIO_API_RETRY_ATTEMPTS = "1";

  const { scheduleToZernio } = await import(`../services/zernio/utils/socialScheduler.js?duplicate-reconcile=${Date.now()}`);
  const result = await scheduleToZernio({
    post: {
      title: "Existing provider post",
      content: existingPost.content,
      imageUrl: existingPost.mediaItems[0].url,
    },
    scheduledDateTime: "2027-01-01 12:00",
    profileName: "General",
    accountId: "ALL",
    dryRun: false,
    apiKey: "test-key",
    laneKey: "podcast-thursday-promo",
    idempotencySeed: "podcast:thursday-promo|2027-01-01 12:00|general|all",
  });

  assert.equal(postBodies.length, 1);
  assert.deepEqual(postBodies[0].mediaItems, existingPost.mediaItems);
  assert.equal(result.scheduled, false);
  assert.equal(result.duplicatePrevented, true);
  assert.equal(result.providerAcceptedExisting, true);
  assert.equal(result.scheduleVerification.accepted, true);
  assert.equal(result.scheduleVerification.duplicateConflictReconciled, true);
  assert.match(result.warnings.join("\n"), /same post is already present/i);

  existingPost.platforms = [{ platform: "facebook", accountId: { _id: "fb-page-1" } }];
  let rejected;
  try {
    await scheduleToZernio({
      post: { content: existingPost.content, imageUrl: existingPost.mediaItems[0].url },
      scheduledDateTime: "2027-01-01 12:00",
      profileName: "General",
      accountId: "ALL",
      dryRun: false,
      apiKey: "test-key",
      laneKey: "podcast-thursday-promo",
      idempotencySeed: "podcast:thursday-promo|2027-01-01 12:00|general|all",
    });
  } catch (error) {
    rejected = error;
  }
  assert.ok(rejected, "a conflict that does not cover every target account must remain a failure");
  assert.equal(rejected.zernioDuplicateReconciliation.accountCoverage, false);
  assert.deepEqual(rejected.zernioDuplicateReconciliation.missingAccountIds, ["ig-account-1"]);
});
