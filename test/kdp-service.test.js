import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import kdpRoutes from "../services/kdp/index.js";
import kdpOperations from "../services/kdp/operations.js";
import { __otpBrokerTestHooks, beginKdpOtpChallenge } from "../services/kdp/otpBroker.js";

const originalAllowlist = process.env.KDP_OTP_ALLOWED_SENDERS;
const originalUsername = process.env.KDP_USERNAME;
const originalPassword = process.env.KDP_PASSWORD;

test.afterEach(() => {
  __otpBrokerTestHooks.reset();
  if (originalAllowlist === undefined) delete process.env.KDP_OTP_ALLOWED_SENDERS;
  else process.env.KDP_OTP_ALLOWED_SENDERS = originalAllowlist;
  if (originalUsername === undefined) delete process.env.KDP_USERNAME;
  else process.env.KDP_USERNAME = originalUsername;
  if (originalPassword === undefined) delete process.env.KDP_PASSWORD;
  else process.env.KDP_PASSWORD = originalPassword;
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/kdp", kdpRoutes);
  return app;
}

test("KDP status reports configuration state without exposing credentials", async () => {
  process.env.KDP_USERNAME = "kdp-user-test";
  process.env.KDP_PASSWORD = "kdp-password-test";
  delete process.env.KDP_OTP_ALLOWED_SENDERS;
  const response = await request(createApp()).get("/kdp/status");

  assert.equal(response.status, 200);
  assert.equal(response.body.service, "KDP");
  assert.equal(response.body.credentialsConfigured, true);
  assert.equal(response.body.otpWebhookConfigured, false);
  assert.equal(JSON.stringify(response.body).includes("kdp-password-test"), false);
});

test("KDP operations expose publishing, audit and readiness endpoints", async () => {
  const routePaths = new Set(kdpOperations.stack.filter((layer) => layer.route).map((layer) => layer.route.path));
  for (const route of [
    "/audit/run",
    "/audit/metadata/update",
    "/audit/pricing/update",
    "/publishing/content/upload",
    "/publishing/titles/create",
    "/publishing/publish",
    "/publishing/titles/delete",
  ]) assert.ok(routePaths.has(route), `expected route ${route}`);

  const [readiness, health] = await Promise.all([
    request(createApp()).get("/kdp/readiness"),
    request(createApp()).get("/kdp/health"),
  ]);
  assert.ok([200, 503].includes(readiness.status));
  assert.deepEqual(readiness.body.subservices, ["KDP_publishing", "KDP_audit"]);
  assert.equal(health.status, 200);
});

test("KDP TextBee handoff only accepts message-received events", async () => {
  const response = await request(createApp())
    .post("/kdp/otp/textbee")
    .send({ webhookEvent: "MESSAGE_DELIVERED", idempotencyKey: "delivery-ignored" });

  assert.equal(response.status, 202);
  assert.deepEqual(response.body, { ok: true, accepted: false, reason: "event_ignored" });
});

test("KDP TextBee handoff does not accept codes from non-allow-listed senders", async () => {
  process.env.KDP_OTP_ALLOWED_SENDERS = "Amazon UK";
  const challenge = beginKdpOtpChallenge({ timeoutMs: 30_000 });
  const cancellation = challenge.promise.catch(() => undefined);
  const response = await request(createApp())
    .post("/kdp/otp/textbee")
    .send({
      webhookEvent: "MESSAGE_RECEIVED",
      idempotencyKey: "delivery-ignored-sender",
      sender: "Amazon",
      message: "Your Amazon security code is 123456",
    });

  assert.equal(response.status, 202);
  assert.deepEqual(response.body, { ok: true, accepted: false, reason: "sender_not_allowed" });
  challenge.cancel();
  await cancellation;
});
