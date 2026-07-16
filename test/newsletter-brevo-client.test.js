import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// Brevo retry/backoff timing comes from config/thresholds.js, which reads
// process.env at import time. Set fast retry values *before* dynamically
// importing the client so tests don't take seconds to run.
process.env.BREVO_RETRIES = "2";
process.env.BREVO_RETRY_BASE_MS = "5";
process.env.BREVO_TIMEOUT_MS = "2000";
process.env.BREVO_API_KEY = "test-key";

let server;
let requestCount = 0;
let failuresBeforeSuccess = 0;
let failureStatus = 500;
let lastApiKeyHeader = null;

before(async () => {
  server = http.createServer((req, res) => {
    requestCount += 1;
    lastApiKeyHeader = req.headers["api-key"];

    if (req.url === "/contacts/lists/1" && requestCount <= failuresBeforeSuccess) {
      res.writeHead(failureStatus, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "rate limited or server error" }));
      return;
    }

    if (req.url === "/contacts/lists/1") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: 1, name: "AI Edge Subscribers", totalSubscribers: 42, totalBlacklisted: 0 }));
      return;
    }

    if (req.url === "/contacts/lists/999") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "not found", code: "document_not_found" }));
      return;
    }

    res.writeHead(404);
    res.end("not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.BREVO_API_BASE_URL = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("newsletter brevo/client.js", () => {
  test("sends the api-key header (not Bearer auth)", async () => {
    const { getList } = await import("../services/newsletter/brevo/client.js");
    requestCount = 0;
    failuresBeforeSuccess = 0;
    await getList(1);
    assert.equal(lastApiKeyHeader, "test-key");
  });

  test("succeeds on the first try when the API is healthy", async () => {
    const { getList } = await import("../services/newsletter/brevo/client.js");
    requestCount = 0;
    failuresBeforeSuccess = 0;
    const result = await getList(1);
    assert.equal(result.ok, true);
    assert.equal(result.data.id, 1);
    assert.equal(requestCount, 1);
  });

  test("retries on a 500 and eventually succeeds", async () => {
    const { getList } = await import("../services/newsletter/brevo/client.js");
    requestCount = 0;
    failuresBeforeSuccess = 2;
    failureStatus = 500;
    const result = await getList(1);
    assert.equal(result.ok, true);
    assert.equal(requestCount, 3); // 2 failures + 1 success
  });

  test("retries on a 429 (rate limited) with exponential backoff", async () => {
    const { getList } = await import("../services/newsletter/brevo/client.js");
    requestCount = 0;
    failuresBeforeSuccess = 1;
    failureStatus = 429;
    const result = await getList(1);
    assert.equal(result.ok, true);
    assert.equal(requestCount, 2);
  });

  test("returns a structured error (not a throw) after exhausting retries", async () => {
    const { getList } = await import("../services/newsletter/brevo/client.js");
    requestCount = 0;
    failuresBeforeSuccess = 999; // always fail
    failureStatus = 500;
    const result = await getList(1);
    assert.equal(result.ok, false);
    assert.equal(requestCount, 3); // 1 initial + 2 retries (BREVO_RETRIES=2)
  });

  test("surfaces a non-retryable 404 immediately without retrying", async () => {
    const { getList } = await import("../services/newsletter/brevo/client.js");
    requestCount = 0;
    const result = await getList(999);
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
    assert.equal(requestCount, 1);
  });
});
