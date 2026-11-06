import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { CloudflareBackupClient } from "../services/comms-hub/clients/cloudflareBackupClient.js";

function importer({ ingest, polls = [], attempts = 3 }) {
  const sql = Buffer.from("CREATE TABLE restored(id INTEGER);");
  const etag = createHash("md5").update(sql).digest("hex");
  const calls = [];
  const delays = [];
  const response = (result) => ({ ok: true, status: 200, json: async () => ({ success: true, result }) });
  const client = new CloudflareBackupClient({
    cloudflareApiBaseUrl: "https://api.cloudflare.com/client/v4",
    cloudflareAccountId: "account",
    d1DatabaseId: "production",
    d1ApiToken: "secret-test-token",
    backupPollAttempts: attempts,
    backupPollMs: 10,
    backupRequestTimeoutMs: 1000,
  }, {
    sleepImpl: async (ms) => { delays.push(ms); },
    fetchImpl: async (url, options) => {
      if (url === "https://upload.example.com/import.sql") {
        calls.push({ action: "upload", sql: options.body });
        return { ok: true, headers: new Headers({ etag }) };
      }
      const body = JSON.parse(options.body);
      calls.push(body);
      if (body.action === "init") return response({ upload_url: "https://upload.example.com/import.sql", filename: "import.sql" });
      if (body.action === "ingest") return response(ingest);
      assert.equal(body.action, "poll");
      assert.ok(polls.length, "unexpected additional poll");
      const next = polls.shift();
      if (next.httpStatus) return {
        ok: false, status: next.httpStatus,
        json: async () => ({ success: false, errors: [{ message: "temporary API failure" }] }),
      };
      return response(next);
    },
  });
  return { run: () => client.importDatabase(sql, "restore"), calls, delays };
}

test("accepted active imports are polled through completion, including the final allowed poll", async () => {
  const { run, calls, delays } = importer({
    ingest: { success: true, status: "active", at_bookmark: "bookmark-one" },
    polls: [
      { success: true, status: "active", at_bookmark: "bookmark-two" },
      { success: true, status: "complete", result: { num_queries: 74 } },
    ],
    attempts: 2,
  });
  const result = await run();
  assert.equal(result.status, "complete");
  assert.equal(result.result.num_queries, 74);
  assert.deepEqual(calls.map((c) => c.action), ["init", "upload", "ingest", "poll", "poll"]);
  assert.deepEqual(calls.slice(3).map((c) => c.current_bookmark), ["bookmark-one", "bookmark-two"]);
  assert.deepEqual(delays, [10, 10]);
});

test("a success flag cannot hide a failed import", async () => {
  const { run, calls } = importer({ ingest: { success: true, status: "error", error: "invalid SQL" } });
  await assert.rejects(run, (error) => error.code === "d1_import_failed" && /invalid SQL/.test(error.message));
  assert.equal(calls.length, 3);
});

test("accepted imports without a completion status must still supply a polling bookmark", async () => {
  const { run } = importer({ ingest: { success: true } });
  await assert.rejects(run, (error) => error.code === "d1_import_response_invalid");
});

test("temporary polling failures reuse the import bookmark without replaying ingest", async () => {
  const { run, calls } = importer({
    ingest: { success: true, status: "active", at_bookmark: "bookmark-one" },
    polls: [{ httpStatus: 503 }, { success: true, status: "complete" }],
    attempts: 2,
  });
  assert.equal((await run()).status, "complete");
  assert.equal(calls.filter((c) => c.action === "ingest").length, 1);
  assert.deepEqual(calls.filter((c) => c.action === "poll").map((c) => c.current_bookmark), ["bookmark-one", "bookmark-one"]);
});

test("poll retries are bounded and include the failing operation without credentials", async () => {
  const { run, calls } = importer({
    ingest: { status: "active", at_bookmark: "bookmark-one" },
    polls: [{ httpStatus: 503 }, { httpStatus: 503 }],
    attempts: 2,
  });
  await assert.rejects(run, (error) => {
    assert.equal(error.code, "cloudflare_backup_api_failed");
    assert.equal(error.retryable, true);
    assert.match(error.message, /POST import \(poll\) failed/);
    assert.doesNotMatch(error.message, /secret-test-token|bookmark-one|upload\.example/);
    return true;
  });
  assert.equal(calls.filter((c) => c.action === "poll").length, 2);
});

test("permanent polling errors are not retried", async () => {
  const { run, calls } = importer({
    ingest: { status: "active", at_bookmark: "bookmark-one" },
    polls: [{ httpStatus: 403 }],
  });
  await assert.rejects(run, (error) => error.code === "cloudflare_backup_api_failed" && !error.retryable);
  assert.equal(calls.filter((c) => c.action === "poll").length, 1);
});

test("an import which never completes times out without querying the database", async () => {
  const active = { success: true, status: "active", at_bookmark: "bookmark-one" };
  const { run, calls } = importer({ ingest: active, polls: [active, active], attempts: 2 });
  await assert.rejects(run, (error) => error.code === "d1_import_timeout" && error.retryable);
  assert.deepEqual(calls.map((c) => c.action), ["init", "upload", "ingest", "poll", "poll"]);
});
