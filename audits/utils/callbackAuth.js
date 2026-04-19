export function extractBearerToken(req) {
  const auth = req.get("authorization") || req.headers?.authorization || "";
  if (typeof auth !== "string") return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function requireAuditCallbackAuth(req, res, next) {
  const expected = String(process.env.AUDIT_CALLBACK_TOKEN || "").trim();
  if (!expected) {
    return res.status(500).json({ ok: false, error: "AUDIT_CALLBACK_TOKEN is not configured" });
  }

  const received = extractBearerToken(req) || req.get("x-audit-callback-token");
  if (!received || String(received).trim() !== expected) {
    return res.status(401).json({ ok: false, error: "Invalid audit callback token" });
  }

  return next();
}

export default requireAuditCallbackAuth;
