import test from "node:test";
import assert from "node:assert/strict";
import { normaliseCloudflarePurgeRequestBody } from "../services/cloudflare-purge/utils/purgeRequest.js";

test("Cloudflare purge request normaliser converts empty webhooks into purge everything", () => {
  assert.deepEqual(normaliseCloudflarePurgeRequestBody({}, {}), { purge_everything: true });
});

test("Cloudflare purge request normaliser accepts common webhook body aliases", () => {
  assert.deepEqual(normaliseCloudflarePurgeRequestBody({ purgeEverything: "yes" }, {}), { purge_everything: true });
  assert.deepEqual(normaliseCloudflarePurgeRequestBody({ mode: "all" }, {}), { purge_everything: true });
  assert.deepEqual(normaliseCloudflarePurgeRequestBody({ urls: "https://example.com/a, https://example.com/b" }, {}), {
    files: ["https://example.com/a", "https://example.com/b"],
  });
});

test("Cloudflare purge request normaliser strips URL schemes from prefixes", () => {
  assert.deepEqual(normaliseCloudflarePurgeRequestBody({ prefixes: ["https://example.com/blog/"] }, {}), {
    prefixes: ["example.com/blog/"],
  });
});

test("Cloudflare purge request normaliser preserves file purge headers", () => {
  assert.deepEqual(
    normaliseCloudflarePurgeRequestBody({ files: [{ url: "https://example.com/a", headers: { "CF-Device-Type": "desktop" } }] }, {}),
    { files: [{ url: "https://example.com/a", headers: { "CF-Device-Type": "desktop" } }] }
  );
});
