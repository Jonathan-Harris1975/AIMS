import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// EmailOctopus retry/backoff timing comes from config/thresholds.js, which
// reads process.env at import time. Set fast retry values *before*
// dynamically importing the client so tests don't take seconds to run.
process.env.EMAILOCTOPUS_RETRIES = "2";
process.env.EMAILOCTOPUS_RETRY_BASE_MS = "5";
process.env.EMAILOCTOPUS_TIMEOUT_MS = "2000";
process.env.EMAILOCTOPUS_API_KEY = "test-key";

let server;
let requestCount = 0;
let failuresBeforeSuccess = 0;
let failureStatus = 500;

before(async () => {
  server = http.createServer((req, res) => {
    requestCount += 1;

    if (req.url === "/lists/list-1" && requestCount <= failuresBeforeSuccess) {
      if (failureStatus === 429) res.setHeader("x-ratelimit-retry-after", "0"); // 0s for fast tests
      res.writeHead(failureStatus, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ title: "rate limited or server error" }));
      return;
    }

    if (req.url === "/lists/list-1") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "list-1", name: "AI Edge Subscribers", counts: { subscribed: 42 } }));
      return;
    }

    if (req.url === "/lists/missing-list") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ title: "not found" }));
      return;
    }

    res.writeHead(404);
    res.end("not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.EMAILOCTOPUS_API_BASE_URL = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("newsletter emailoctopus/client.js", () => {
  test("succeeds on the first try when the API is healthy", async () => {
    const { getList } = await import("../services/newsletter/emailoctopus/client.js");
    requestCount = 0;
    failuresBeforeSuccess = 0;
    const result = await getList("list-1");
    assert.equal(result.ok, true);
    assert.equal(result.data.id, "list-1");
    assert.equal(requestCount, 1);
  });

  test("retries on a 500 and eventually succeeds", async () => {
    const { getList } = await import("../services/newsletter/emailoctopus/client.js");
    requestCount = 0;
    failuresBeforeSuccess = 2;
    failureStatus = 500;
    const result = await getList("list-1");
    assert.equal(result.ok, true);
    assert.equal(requestCount, 3); // 2 failures + 1 success
  });

  test("honours the X-RateLimit-Retry-After header on 429", async () => {
    const { getList } = await import("../services/newsletter/emailoctopus/client.js");
    requestCount = 0;
    failuresBeforeSuccess = 1;
    failureStatus = 429;
    const result = await getList("list-1");
    assert.equal(result.ok, true);
    assert.equal(requestCount, 2);
  });

  test("returns a structured error (not a throw) after exhausting retries", async () => {
    const { getList } = await import("../services/newsletter/emailoctopus/client.js");
    requestCount = 0;
    failuresBeforeSuccess = 999; // always fail
    failureStatus = 500;
    const result = await getList("list-1");
    assert.equal(result.ok, false);
    assert.equal(requestCount, 3); // 1 initial + 2 retries (EMAILOCTOPUS_RETRIES=2)
  });

  test("surfaces a non-retryable 404 immediately without retrying", async () => {
    const { getList } = await import("../services/newsletter/emailoctopus/client.js");
    requestCount = 0;
    const result = await getList("missing-list");
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
    assert.equal(requestCount, 1);
  });

  test("attemptCreateCampaign is disabled by default (no undocumented endpoint call)", async () => {
    const { attemptCreateCampaign } = await import("../services/newsletter/emailoctopus/client.js");
    const result = await attemptCreateCampaign({ subject: "test" });
    assert.equal(result.ok, false);
    assert.match(result.error, /does not document/i);
  });
});
