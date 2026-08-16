import test from "node:test";
import assert from "node:assert/strict";
import {
  isTemporaryPublicOutreachBatchNextPath,
  requireAimsBearerAuth,
} from "../services/shared/middleware/suiteAuth.js";

function withEnv(values, fn) {
  const previous = {};
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  return Promise.resolve().then(fn).finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function req(method, originalUrl, headers = {}) {
  const lowered = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    method,
    originalUrl,
    headers: lowered,
    get(name) { return lowered[String(name).toLowerCase()] || ""; },
  };
}

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    set(name, value) { this.headers[String(name).toLowerCase()] = value; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("temporary public Outreach bridge matches only POST /outreach/batch/next", async () => {
  await withEnv({ OUTREACH_BATCH_NEXT_ALLOW_PUBLIC: "true" }, async () => {
    assert.equal(isTemporaryPublicOutreachBatchNextPath(req("POST", "/outreach/batch/next")), true);
    assert.equal(isTemporaryPublicOutreachBatchNextPath(req("POST", "/outreach/batch/next?source=make")), true);
    assert.equal(isTemporaryPublicOutreachBatchNextPath(req("POST", "/outreach/batch/next/")), true);
    assert.equal(isTemporaryPublicOutreachBatchNextPath(req("GET", "/outreach/batch/next")), false);
    assert.equal(isTemporaryPublicOutreachBatchNextPath(req("POST", "/outreach/keyword")), false);
    assert.equal(isTemporaryPublicOutreachBatchNextPath(req("POST", "/outreach/batch/reset")), false);
  });
});

test("temporary public Outreach bridge bypasses suite auth only when explicitly enabled", async () => {
  await withEnv({ NODE_ENV: "production", AIMS_API_KEY: "test-suite-key", OUTREACH_BATCH_NEXT_ALLOW_PUBLIC: "true" }, async () => {
    const request = req("POST", "/outreach/batch/next");
    const response = responseRecorder();
    let passed = false;
    requireAimsBearerAuth(request, response, () => { passed = true; });
    assert.equal(passed, true);
    assert.equal(request.aimsAuth?.strategy, "temporary-public-outreach-batch-next");
    assert.equal(response.body, null);
  });
});

test("temporary public Outreach bridge fails closed when switch is false", async () => {
  await withEnv({ NODE_ENV: "production", AIMS_API_KEY: "test-suite-key", OUTREACH_BATCH_NEXT_ALLOW_PUBLIC: "false" }, async () => {
    const request = req("POST", "/outreach/batch/next");
    const response = responseRecorder();
    let passed = false;
    requireAimsBearerAuth(request, response, () => { passed = true; });
    assert.equal(passed, false);
    assert.equal(response.statusCode, 401);
    assert.equal(response.body?.error, "unauthorized");
  });
});

test("other Outreach mutations remain bearer-protected while batch-next is public", async () => {
  await withEnv({ NODE_ENV: "production", AIMS_API_KEY: "test-suite-key", OUTREACH_BATCH_NEXT_ALLOW_PUBLIC: "true" }, async () => {
    for (const path of ["/outreach/keyword", "/outreach/batch/reset"]) {
      const request = req("POST", path);
      const response = responseRecorder();
      let passed = false;
      requireAimsBearerAuth(request, response, () => { passed = true; });
      assert.equal(passed, false, path);
      assert.equal(response.statusCode, 401, path);
    }
  });
});
