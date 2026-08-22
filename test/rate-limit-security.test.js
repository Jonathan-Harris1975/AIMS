import assert from "node:assert/strict";
import test from "node:test";

import { getRateLimitClientId } from "../services/shared/http/clientIdentity.js";
import { parseTrustProxy } from "../services/shared/http/trustProxy.js";

test("TRUST_PROXY=1 means one proxy hop, not trust-all", () => {
  assert.equal(parseTrustProxy("1"), 1);
  assert.equal(parseTrustProxy("0"), 0);
  assert.equal(parseTrustProxy("true"), true);
  assert.equal(parseTrustProxy(undefined, "production"), 1);
});

test("rate-limit client identity ignores raw X-Forwarded-For", () => {
  const base = {
    ip: "203.0.113.20",
    socket: { remoteAddress: "127.0.0.1" },
  };

  const first = getRateLimitClientId({ ...base, headers: { "x-forwarded-for": "198.51.100.10" } });
  const second = getRateLimitClientId({ ...base, headers: { "x-forwarded-for": "198.51.100.99" } });

  assert.equal(first, "203.0.113.20");
  assert.equal(second, "203.0.113.20");
});

test("authentication and rate limiting run before request body parsers", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../server.js", import.meta.url), "utf8");
  const limiter = source.indexOf("app.use(createRateLimitMiddleware())");
  const auth = source.indexOf("app.use(requireAimsBearerAuth);");
  const commsParser = source.indexOf("limit: commsHubMaxWebhookBytes");
  const generalParser = source.indexOf('limit: process.env.JSON_BODY_LIMIT || "10mb"');

  assert.ok(limiter >= 0, "rate limiter must be mounted");
  assert.ok(auth > limiter, "authentication must follow the abuse limiter");
  assert.ok(commsParser > auth, "Comms Hub parser must run after authentication gating");
  assert.ok(generalParser > auth, "general JSON parser must run after authentication gating");
  assert.match(source, /type: \(req\) => Boolean\(commsHubIntakePath\(req\)\) && isJsonRequest\(req\)/);
  assert.match(source, /type: \(req\) => !commsHubIntakePath\(req\) && isJsonRequest\(req\)/);
});
