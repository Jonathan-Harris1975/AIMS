import express from "express";
import { deliverKdpOtpFromTextBee, getKdpOtpChallengeStatus } from "./otpBroker.js";
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
  return res.status(202).json({ ok: true, ...result });
});

export default router;
