import test from "node:test";
import assert from "node:assert/strict";
import {
  __otpBrokerTestHooks,
  beginKdpOtpChallenge,
  deliverKdpOtpFromTextBee,
  extractAmazonOtp,
  getKdpOtpChallengeStatus,
} from "../services/kdp/otpBroker.js";

const originalAllowlist = process.env.KDP_OTP_ALLOWED_SENDERS;

test.afterEach(() => {
  __otpBrokerTestHooks.reset();
  if (originalAllowlist === undefined) delete process.env.KDP_OTP_ALLOWED_SENDERS;
  else process.env.KDP_OTP_ALLOWED_SENDERS = originalAllowlist;
});

test("OTP extraction requires an allow-listed sender and Amazon-branded code text", () => {
  process.env.KDP_OTP_ALLOWED_SENDERS = "AMAZON, 12345";
  assert.equal(extractAmazonOtp("Your Amazon security code is 123456", "amazon"), "123456");
  assert.equal(extractAmazonOtp("Your Amazon verification code: 654321", "AMAZON"), "654321");
  assert.equal(extractAmazonOtp("Your verification code is 123456", "amazon"), null);
  assert.equal(extractAmazonOtp("Your Amazon security code is 123456", "unknown"), null);
  assert.equal(extractAmazonOtp("Your Amazon alert is 123456", "amazon"), null);
});

test("TextBee rejection reasons identify why an OTP was not delivered", () => {
  process.env.KDP_OTP_ALLOWED_SENDERS = "AMAZON";
  assert.deepEqual(deliverKdpOtpFromTextBee({ sender: "Amazon", message: "Amazon code 123456" }), {
    accepted: false,
    reason: "no_active_challenge",
  });

  const challenge = beginKdpOtpChallenge({ timeoutMs: 30_000 });
  const cancellation = challenge.promise.catch(() => undefined);
  assert.deepEqual(deliverKdpOtpFromTextBee({ sender: "Other", message: "Amazon code 123456" }), {
    accepted: false,
    reason: "sender_not_allowed",
  });
  assert.deepEqual(deliverKdpOtpFromTextBee({ sender: "Amazon", message: "Your parcel is on the way" }), {
    accepted: false,
    reason: "non_amazon_message",
  });
  assert.deepEqual(deliverKdpOtpFromTextBee({ sender: "Amazon", message: "Amazon sign-in request" }), {
    accepted: false,
    reason: "verification_code_not_found",
  });
  challenge.cancel();
  return cancellation;
});

test("an OTP resolves exactly one active challenge and is not retained", async () => {
  process.env.KDP_OTP_ALLOWED_SENDERS = "AMAZON";
  const challenge = beginKdpOtpChallenge({ timeoutMs: 30_000 });
  assert.deepEqual(getKdpOtpChallengeStatus(), {
    active: true,
    challengeId: challenge.challengeId,
    startedAt: getKdpOtpChallengeStatus().startedAt,
    expiresAt: getKdpOtpChallengeStatus().expiresAt,
  });

  assert.deepEqual(deliverKdpOtpFromTextBee({
    sender: "Amazon",
    message: "Your Amazon verification code is 123456",
  }), { accepted: true, challengeId: challenge.challengeId });
  assert.equal(await challenge.promise, "123456");
  assert.deepEqual(getKdpOtpChallengeStatus(), { active: false });
  assert.equal(deliverKdpOtpFromTextBee({ sender: "Amazon", message: "Amazon code 654321" }).accepted, false);
});

test("only one OTP challenge can be active at once", () => {
  const challenge = beginKdpOtpChallenge({ timeoutMs: 30_000 });
  const cancellation = challenge.promise.catch(() => undefined);
  assert.throws(() => beginKdpOtpChallenge(), /already active/);
  challenge.cancel();
  assert.deepEqual(getKdpOtpChallengeStatus(), { active: false });
  return cancellation;
});
