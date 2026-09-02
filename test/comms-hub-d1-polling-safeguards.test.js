import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { D1Client, nextUtcMidnight } from "../services/comms-hub/clients/d1Client.js";
import { retryableError, withRetry } from "../services/comms-hub/clients/retry.js";
import dataPlaneWorker from "../workers/comms-hub-data-plane/worker.js";

const quotaMessage = "D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC).";

function d1Config() {
  return {
    cloudflareAccountId: "",
    cloudflareApiBaseUrl: "https://api.cloudflare.test/client/v4",
    d1ApiToken: "d1-token",
    d1DatabaseId: "database-id",
    d1ProxyUrl: "https://d1-proxy.test/query",
    d1ProxyToken: "proxy-token",
    d1TimeoutMs: 1_000,
    providerRetryAttempts: 4,
    providerRetryBaseMs: 1,
    providerRetryMaxMs: 1,
  };
}

test("an explicit non-retryable provider decision overrides a translated 502", async () => {
  let calls = 0;
  const error = Object.assign(new Error("permanent provider failure"), {
    statusCode: 502,
    retryable: false,
  });

  await assert.rejects(
    withRetry(async () => {
      calls += 1;
      throw error;
    }, { attempts: 4, baseMs: 1, maxMs: 1 }),
    error,
  );

  assert.equal(calls, 1);
  assert.equal(retryableError(Object.assign(new Error("retry me"), { statusCode: 400, retryable: true })), true);
});

test("D1 daily quota failure opens a local circuit until midnight UTC", async () => {
  const start = Date.UTC(2026, 8, 2, 22, 15, 0);
  let now = start;
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    if (fetchCalls === 1) {
      return new Response(JSON.stringify({ success: false, errors: [{ message: quotaMessage }] }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      success: true,
      result: [{ success: true, results: [{ ok: 1 }], meta: { rows_read: 1, rows_written: 0 } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const client = new D1Client(d1Config(), { fetchImpl, now: () => now });

  await assert.rejects(client.query("SELECT 1"), (error) => {
    assert.equal(error.code, "d1_daily_row_read_limit");
    assert.equal(error.retryable, false);
    assert.equal(error.blockedUntil, "2026-09-03T00:00:00.000Z");
    return true;
  });
  assert.equal(fetchCalls, 1, "quota response must not be retried");

  await assert.rejects(client.query("SELECT 1"), { code: "d1_daily_row_read_limit" });
  assert.equal(fetchCalls, 1, "open circuit must prevent another network request");

  now = nextUtcMidnight(start);
  const result = await client.query("SELECT 1");
  assert.deepEqual(result.results, [{ ok: 1 }]);
  assert.equal(fetchCalls, 2, "circuit must close when the UTC allowance resets");
});

test("D1 data plane classifies the daily quota response as HTTP 429", async () => {
  const request = new Request("https://data-plane.test/query", {
    method: "POST",
    headers: {
      authorization: "Bearer shared-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({ sql: "SELECT 1", params: [] }),
  });
  const response = await dataPlaneWorker.fetch(request, {
    COMMS_HUB_D1_PROXY_TOKEN: "shared-token",
    COMMS_HUB_DB: {
      prepare() {
        return {
          bind() {
            return { all: async () => { throw new Error(quotaMessage); } };
          },
        };
      },
    },
  });
  const payload = await response.json();

  assert.equal(response.status, 429);
  assert.equal(payload.retryable, false);
  assert.equal(payload.errors[0].code, "d1_daily_row_read_limit");
});

test("production polling defaults use webhook-first reconciliation intervals", () => {
  const source = fs.readFileSync(new URL("../config/production.defaults.env", import.meta.url), "utf8");
  for (const expected of [
    "COMMS_HUB_ARCHIVE_POLL_MS=300000",
    "COMMS_HUB_ZERNIO_POLL_MS=3600000",
    "COMMS_HUB_FOLLOW_UP_POLL_MS=900000",
    "COMMS_HUB_PROVIDER_HEALTH_POLL_MS=900000",
    "COMMS_HUB_EMAIL_POLL_MS=300000",
    "COMMS_HUB_DELAYED_ACTION_POLL_MS=300000",
  ]) assert.match(source, new RegExp(`^${expected}$`, "m"));
});
