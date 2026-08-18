export function getRateLimitClientId(req) {
  // Express resolves req.ip through the explicitly configured trust-proxy policy.
  // Never read X-Forwarded-For directly here: a client-controlled forwarding
  // header must not be able to choose its own rate-limit bucket.
  return req?.ip || req?.socket?.remoteAddress || "unknown";
}
