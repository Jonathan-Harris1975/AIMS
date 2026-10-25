import { randomUUID } from "node:crypto";

const DEFAULT_CHALLENGE_TIMEOUT_MS = 180_000;
const MIN_CHALLENGE_TIMEOUT_MS = 30_000;
const MAX_CHALLENGE_TIMEOUT_MS = 300_000;
let activeChallenge = null;

function challengeTimeoutMs() {
  const configured = Number(process.env.KDP_OTP_CHALLENGE_TIMEOUT_MS);
  if (!Number.isInteger(configured)) return DEFAULT_CHALLENGE_TIMEOUT_MS;
  return Math.min(MAX_CHALLENGE_TIMEOUT_MS, Math.max(MIN_CHALLENGE_TIMEOUT_MS, configured));
}

function allowedSenders() {
  return new Set(
    String(process.env.KDP_OTP_ALLOWED_SENDERS || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function extractAmazonOtp(message, sender) {
  if (typeof message !== "string" || typeof sender !== "string") return null;
  const senderAllowlist = allowedSenders();
  if (!senderAllowlist.size || !senderAllowlist.has(sender.trim().toLowerCase())) return null;
  if (!/\bamazon\b/i.test(message)) return null;

  const match = message.match(/\b(?:verification|security|sign[ -]?in|one[ -]?time)?\s*(?:code|otp)\b\D{0,16}(\d{6})\b/i);
  return match?.[1] ?? null;
}

export function beginKdpOtpChallenge({ timeoutMs = challengeTimeoutMs() } = {}) {
  if (activeChallenge) {
    throw new Error("A KDP OTP challenge is already active.");
  }

  const boundedTimeout = Math.min(MAX_CHALLENGE_TIMEOUT_MS, Math.max(MIN_CHALLENGE_TIMEOUT_MS, Number(timeoutMs) || DEFAULT_CHALLENGE_TIMEOUT_MS));
  const challengeId = randomUUID();
  let resolveOtp;
  let rejectOtp;
  const promise = new Promise((resolve, reject) => {
    resolveOtp = resolve;
    rejectOtp = reject;
  });
  const timer = setTimeout(() => {
    if (activeChallenge?.challengeId !== challengeId) return;
    activeChallenge = null;
    rejectOtp(new Error("KDP OTP challenge timed out."));
  }, boundedTimeout);
  timer.unref?.();

  activeChallenge = {
    challengeId,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + boundedTimeout).toISOString(),
    resolveOtp,
    rejectOtp,
    timer,
  };

  return {
    challengeId,
    promise,
    cancel(reason = "KDP OTP challenge was cancelled.") {
      if (activeChallenge?.challengeId !== challengeId) return false;
      clearTimeout(activeChallenge.timer);
      activeChallenge = null;
      rejectOtp(new Error(reason));
      return true;
    },
  };
}

export function deliverKdpOtpFromTextBee(payload) {
  const code = extractAmazonOtp(payload?.message, payload?.sender);
  if (!code || !activeChallenge || Date.now() >= Date.parse(activeChallenge.expiresAt)) {
    return { accepted: false, reason: !code ? "sender_or_message_not_allowed" : "no_active_challenge" };
  }

  const challenge = activeChallenge;
  clearTimeout(challenge.timer);
  activeChallenge = null;
  challenge.resolveOtp(code);
  return { accepted: true, challengeId: challenge.challengeId };
}

export function getKdpOtpChallengeStatus() {
  if (!activeChallenge) return { active: false };
  return {
    active: true,
    challengeId: activeChallenge.challengeId,
    startedAt: activeChallenge.startedAt,
    expiresAt: activeChallenge.expiresAt,
  };
}

export const __otpBrokerTestHooks = {
  allowedSenders,
  reset() {
    if (activeChallenge) clearTimeout(activeChallenge.timer);
    activeChallenge = null;
  },
};
