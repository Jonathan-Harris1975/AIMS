import test from "node:test";
import assert from "node:assert/strict";
import worker from "../workers/newsletter-confirm-proxy/worker.js";

const TOKEN = "a".repeat(43);
const ORIGIN = "https://zeroth-kara-jonathanharris-3296ed37.koyeb.app";

test("confirmation proxy forwards only the branded confirmation endpoint", async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (request) => {
    calls.push(new Request(request));
    return new Response("upstream response", { status: 200 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await worker.fetch(new Request(
    `https://confirm.jonathan-harris.online/newsletter/confirm/${TOKEN}?source=test`,
  ));

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).origin, ORIGIN);
  assert.equal(new URL(calls[0].url).pathname, `/newsletter/confirm/${TOKEN}`);
  assert.equal(new URL(calls[0].url).search, "?source=test");
});

test("confirmation proxy rejects unrelated paths and methods before forwarding", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("unexpected upstream request"); };
  t.after(() => { globalThis.fetch = originalFetch; });

  const otherPath = await worker.fetch(new Request("https://confirm.jonathan-harris.online/other"));
  assert.equal(otherPath.status, 404);

  const otherMethod = await worker.fetch(new Request(
    `https://confirm.jonathan-harris.online/newsletter/confirm/${TOKEN}`,
    { method: "POST" },
  ));
  assert.equal(otherMethod.status, 405);
});
