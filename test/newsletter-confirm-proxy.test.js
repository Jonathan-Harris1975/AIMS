import test from "node:test";
import assert from "node:assert/strict";
import worker from "../workers/newsletter-confirm-proxy/worker.js";

const TOKEN = "a".repeat(43);
const ORIGIN = "https://zeroth-kara-jonathanharris-3296ed37.koyeb.app";
const SOURCE_SHA = "b".repeat(40);

test("health reports only a valid full source SHA", async () => {
  const response = await worker.fetch(
    new Request("https://confirm.jonathan-harris.online/health"),
    { SOURCE_COMMIT_SHA: SOURCE_SHA },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    service: "newsletter-confirm-proxy",
    source_commit_sha: SOURCE_SHA,
  });

  const unattested = await worker.fetch(
    new Request("https://confirm.jonathan-harris.online/health"),
    {},
  );
  assert.equal(unattested.status, 503);
  assert.equal((await unattested.json()).source_commit_sha, null);
});

test("confirmation proxy forwards only the branded confirmation endpoint without logging its token", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalInfo = console.info;
  const calls = [];
  const logs = [];
  globalThis.fetch = async (request) => {
    calls.push(new Request(request));
    return new Response("upstream response", { status: 200 });
  };
  console.info = (entry) => logs.push(entry);
  t.after(() => {
    globalThis.fetch = originalFetch;
    console.info = originalInfo;
  });

  const response = await worker.fetch(new Request(
    `https://confirm.jonathan-harris.online/newsletter/confirm/${TOKEN}?source=test`,
  ), { SOURCE_COMMIT_SHA: SOURCE_SHA });

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).origin, ORIGIN);
  assert.equal(new URL(calls[0].url).pathname, `/newsletter/confirm/${TOKEN}`);
  assert.equal(new URL(calls[0].url).search, "?source=test");
  assert.equal(JSON.stringify(logs).includes(TOKEN), false);
  assert.equal(JSON.stringify(logs).includes("source=test"), false);
});

test("confirmation proxy rejects unrelated paths and methods before forwarding", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalInfo = console.info;
  globalThis.fetch = async () => { throw new Error("unexpected upstream request"); };
  console.info = () => {};
  t.after(() => {
    globalThis.fetch = originalFetch;
    console.info = originalInfo;
  });

  const otherPath = await worker.fetch(new Request("https://confirm.jonathan-harris.online/other"));
  assert.equal(otherPath.status, 404);

  const otherMethod = await worker.fetch(new Request(
    `https://confirm.jonathan-harris.online/newsletter/confirm/${TOKEN}`,
    { method: "POST" },
  ));
  assert.equal(otherMethod.status, 405);
});
