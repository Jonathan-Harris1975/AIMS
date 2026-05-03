import test from "node:test";
import assert from "node:assert/strict";
import { extractBearerToken, requireAuditCallbackAuth, resolveExpectedAuditCallbackToken } from "../audits/utils/callbackAuth.js";

function mockReq(headers = {}) {
  const normalised = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    headers: normalised,
    get(name) {
      return normalised[String(name).toLowerCase()];
    },
  };
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test("resolveExpectedAuditCallbackToken accepts AI_SUITE_AUDIT_CALLBACK_TOKEN", () => {
  const oldAudit = process.env.AUDIT_CALLBACK_TOKEN;
  const oldSuite = process.env.AI_SUITE_AUDIT_CALLBACK_TOKEN;
  delete process.env.AUDIT_CALLBACK_TOKEN;
  process.env.AI_SUITE_AUDIT_CALLBACK_TOKEN = "suite-token";

  try {
    assert.equal(resolveExpectedAuditCallbackToken(), "suite-token");
  } finally {
    if (oldAudit === undefined) delete process.env.AUDIT_CALLBACK_TOKEN;
    else process.env.AUDIT_CALLBACK_TOKEN = oldAudit;
    if (oldSuite === undefined) delete process.env.AI_SUITE_AUDIT_CALLBACK_TOKEN;
    else process.env.AI_SUITE_AUDIT_CALLBACK_TOKEN = oldSuite;
  }
});

test("requireAuditCallbackAuth accepts bearer token from suite token env", () => {
  const oldAudit = process.env.AUDIT_CALLBACK_TOKEN;
  const oldSuite = process.env.AI_SUITE_AUDIT_CALLBACK_TOKEN;
  delete process.env.AUDIT_CALLBACK_TOKEN;
  process.env.AI_SUITE_AUDIT_CALLBACK_TOKEN = "suite-token";

  const req = mockReq({ authorization: "Bearer suite-token" });
  const res = mockRes();
  let called = false;

  try {
    requireAuditCallbackAuth(req, res, () => {
      called = true;
    });
    assert.equal(called, true);
    assert.equal(res.statusCode, 200);
  } finally {
    if (oldAudit === undefined) delete process.env.AUDIT_CALLBACK_TOKEN;
    else process.env.AUDIT_CALLBACK_TOKEN = oldAudit;
    if (oldSuite === undefined) delete process.env.AI_SUITE_AUDIT_CALLBACK_TOKEN;
    else process.env.AI_SUITE_AUDIT_CALLBACK_TOKEN = oldSuite;
  }
});

test("requireAuditCallbackAuth rejects invalid token without leaking expected secret", () => {
  const oldAudit = process.env.AUDIT_CALLBACK_TOKEN;
  const oldSuite = process.env.AI_SUITE_AUDIT_CALLBACK_TOKEN;
  process.env.AUDIT_CALLBACK_TOKEN = "expected-secret";
  delete process.env.AI_SUITE_AUDIT_CALLBACK_TOKEN;

  const req = mockReq({ authorization: "Bearer wrong" });
  const res = mockRes();

  try {
    requireAuditCallbackAuth(req, res, () => assert.fail("next should not be called"));
    assert.equal(res.statusCode, 401);
    assert.equal(JSON.stringify(res.body).includes("expected-secret"), false);
  } finally {
    if (oldAudit === undefined) delete process.env.AUDIT_CALLBACK_TOKEN;
    else process.env.AUDIT_CALLBACK_TOKEN = oldAudit;
    if (oldSuite === undefined) delete process.env.AI_SUITE_AUDIT_CALLBACK_TOKEN;
    else process.env.AI_SUITE_AUDIT_CALLBACK_TOKEN = oldSuite;
  }
});

test("extractBearerToken parses bearer authorisation header", () => {
  assert.equal(extractBearerToken(mockReq({ authorization: "Bearer abc123" })), "abc123");
});
