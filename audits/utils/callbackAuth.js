export function extractBearerToken(req) {
  const auth = req.get("authorization") || req.headers?.authorization || "";
  if (typeof auth !== "string") return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function requireAuditCallbackAuth(req, res, next) {
  const expectedTokens = [process.env.AUDIT_CALLBACK_TOKEN, process.env.AI_SUITE_AUDIT_CALLBACK_TOKEN]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (!expectedTokens.length) {
    return res.status(500).json({ ok: false, error: "AUDIT_CALLBACK_TOKEN or AI_SUITE_AUDIT_CALLBACK_TOKEN is not configured" });
  }

  const received = extractBearerToken(req) || req.get("x-audit-callback-token");
  if (!received || !expectedTokens.includes(String(received).trim())) {
    return res.status(401).json({ ok: false, error: "Invalid audit callback token" });
  }

  return next();
}

export default requireAuditCallbackAuth;
