import express from "express";
import { deliverKdpOtpFromTextBee, getKdpOtpChallengeStatus, getKdpOtpDeliveryStatus } from "./otpBroker.js";
import kdpOperations from "./operations.js";
import { getKdpReadiness } from "./readiness.js";

const router = express.Router();

router.get("/status", (_req, res) => {
  const readiness = getKdpReadiness();
  res.set("Cache-Control", "no-store");
  res.status(200).json({
    ok: true,
    service: "KDP",
    subservices: ["KDP_publishing", "KDP_audit"],
    credentialsConfigured: Boolean(process.env.KDP_USERNAME && process.env.KDP_PASSWORD),
    otpWebhookConfigured: Boolean(process.env.KDP_OTP_ALLOWED_SENDERS),
    otpChallenge: getKdpOtpChallengeStatus(),
    otpDelivery: getKdpOtpDeliveryStatus(),
    readiness,
    phase: "publishing-and-audit",
  });
});

router.use("/", kdpOperations);

router.post("/otp/textbee", (req, res) => {
  const payload = req.body && typeof req.body === "object" ? req.body : {};
  if (payload.webhookEvent !== "MESSAGE_RECEIVED") {
    return res.status(202).json({ ok: true, accepted: false, reason: "event_ignored" });
  }
  if (typeof payload.idempotencyKey !== "string" || payload.idempotencyKey.length > 200) {
    return res.status(400).json({ ok: false, error: "Invalid TextBee idempotency key." });
  }

  const result = deliverKdpOtpFromTextBee(payload);
  res.set("Cache-Control", "no-store");
  // Do not advertise HTTP success for an OTP that the browser never consumed.
  // The HIVE gateway must be able to distinguish an unserved login challenge
  // from an actual accepted one. Rejections never contain the SMS or code.
  const transient = ["no_active_challenge", "challenge_expired"].includes(result.reason);
  return res.status(result.accepted ? 202 : transient ? 503 : 422)
    .json({ ok: result.accepted, ...result });
});

export default router;
