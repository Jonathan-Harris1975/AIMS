import assert from "node:assert/strict";
import test from "node:test";
import { testCredential } from "./helpers/testCredentials.js";

import { isPublicHealthRequest, requireAimsBearerAuth } from "../services/shared/middleware/suiteAuth.js";

function request(path, method = "GET") {
  return {
    method,
    originalUrl: path,
    url: path,
    path,
    headers: {},
    get() { return ""; },
  };
}

function responseRecorder() {
  const state = { status: null, body: null };
  return {
    state,
    status(code) { state.status = code; return this; },
    set() { return this; },
    json(body) { state.body = body; return this; },
  };
}

test("liveness and readiness probes remain public in production", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAimsKey = process.env.AIMS_API_KEY;
  const previousSuiteKey = process.env.AI_SUITE_API_KEY;

  process.env.NODE_ENV = "production";
  process.env.AIMS_API_KEY = testCredential("aims-production");
  delete process.env.AI_SUITE_API_KEY;

  try {
    for (const path of ["/health", "/livez", "/readyz", "/ops/health"]) {
      const req = request(path);
      const res = responseRecorder();
      let passed = false;
      requireAimsBearerAuth(req, res, () => { passed = true; });

      assert.equal(isPublicHealthRequest(req), true, `${path} must be classified as public health`);
      assert.equal(passed, true, `${path} must bypass suite bearer auth in production`);
      assert.equal(res.state.status, null, `${path} must not produce an auth response`);
    }
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousAimsKey === undefined) delete process.env.AIMS_API_KEY;
    else process.env.AIMS_API_KEY = previousAimsKey;
    if (previousSuiteKey === undefined) delete process.env.AI_SUITE_API_KEY;
    else process.env.AI_SUITE_API_KEY = previousSuiteKey;
  }
});

test("non-health endpoints remain protected in production", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAimsKey = process.env.AIMS_API_KEY;
  const previousSuiteKey = process.env.AI_SUITE_API_KEY;

  process.env.NODE_ENV = "production";
  process.env.AIMS_API_KEY = testCredential("aims-production");
  delete process.env.AI_SUITE_API_KEY;

  try {
    const req = request("/ops/status");
    const res = responseRecorder();
    let passed = false;
    requireAimsBearerAuth(req, res, () => { passed = true; });

    assert.equal(isPublicHealthRequest(req), false);
    assert.equal(passed, false);
    assert.equal(res.state.status, 401);
    assert.equal(res.state.body?.error, "unauthorized");
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousAimsKey === undefined) delete process.env.AIMS_API_KEY;
    else process.env.AIMS_API_KEY = previousAimsKey;
    if (previousSuiteKey === undefined) delete process.env.AI_SUITE_API_KEY;
    else process.env.AI_SUITE_API_KEY = previousSuiteKey;
  }
});
