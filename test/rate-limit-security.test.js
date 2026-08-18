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
