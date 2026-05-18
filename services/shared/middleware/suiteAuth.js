import crypto from "node:crypto";

function normalise(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function isProductionEnv() {
  return normalise(process.env.NODE_ENV).toLowerCase() === "production";
}


function looksLikeSecretPlaceholder(value) {
  return /^\{\{\s*secret\.[^}]+\}\}$/i.test(normalise(value));
}

function truthy(value) {
  return ["1", "true", "yes", "y", "on"].includes(normalise(value).toLowerCase());
}

function safeEqual(received, expected) {
  const left = Buffer.from(normalise(received));
  const right = Buffer.from(normalise(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function extractBearerToken(req) {
  const auth = req.get?.("authorization") || req.headers?.authorization || "";
  const match = String(auth).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function pathWithoutQuery(req) {
  const raw = req.originalUrl || req.url || req.path || "/";
  return String(raw).split("?")[0] || "/";
}

export function isPublicHealthRequest(req) {
  if (!["GET", "HEAD"].includes(String(req.method || "").toUpperCase())) return false;
  const path = pathWithoutQuery(req).replace(/\/+$/, "") || "/";
  return path === "/" || path === "/health" || path.toLowerCase().endsWith("/health");
}

function expectedSuiteKey() {
  const value = normalise(process.env.AIMS_API_KEY || process.env.AI_SUITE_API_KEY);
  return looksLikeSecretPlaceholder(value) ? "" : value;
}

function expectedAuditCallbackKey() {
  const value = normalise(process.env.AUDIT_CALLBACK_TOKEN || process.env.AI_SUITE_AUDIT_CALLBACK_TOKEN);
  return looksLikeSecretPlaceholder(value) ? "" : value;
}

function expectedCloudflarePurgeSecret() {
  const value = normalise(process.env.CLOUDFLARE_PURGE_SHARED_SECRET);
  return looksLikeSecretPlaceholder(value) ? "" : value;
}

function allowsUnauthenticatedDevelopment() {
  if (isProductionEnv()) return false;
  return truthy(process.env.AIMS_ALLOW_UNAUTHENTICATED_DEV) || !expectedSuiteKey();
}

function isLegacyAuditCallbackPath(req) {
  const path = pathWithoutQuery(req).toLowerCase();
  return path.startsWith("/audits/") && (
    path.includes("/callback") || path.includes("/analysis") || path.includes("/jobs/")
  );
}

function isCloudflarePurgePath(req) {
  const method = String(req.method || "").toUpperCase();
  if (method !== "POST") return false;
  const path = pathWithoutQuery(req).replace(/\/+$/, "").toLowerCase();
  return path === "/cloudflare/purge";
}

function extractCloudflarePurgeSecret(req) {
  return normalise(req.get?.("x-cloudflare-purge-secret") || req.headers?.["x-cloudflare-purge-secret"]);
}

function hasValidCloudflarePurgeSecret(req) {
  const expected = expectedCloudflarePurgeSecret();
  const provided = extractCloudflarePurgeSecret(req);
  return Boolean(expected && provided && safeEqual(provided, expected));
}

export function requireAimsBearerAuth(req, res, next) {
  if (String(req.method || "").toUpperCase() === "OPTIONS") return next();
  if (isPublicHealthRequest(req)) return next();

  if (isCloudflarePurgePath(req) && hasValidCloudflarePurgeSecret(req)) {
    req.aimsAuth = { strategy: "cloudflare-purge-secret" };
    return next();
  }

  const expected = expectedSuiteKey();
  if (!expected) {
    if (allowsUnauthenticatedDevelopment()) return next();
    return res.status(503).json({
      ok: false,
      error: "AIMS_API_KEY is required for protected endpoints",
      hint: "Set AIMS_API_KEY in the deployed environment. Health endpoints remain public.",
    });
  }

  const token = extractBearerToken(req);
  if (token && safeEqual(token, expected)) {
    req.aimsAuth = { strategy: "suite-bearer" };
    return next();
  }

  const callbackKey = expectedAuditCallbackKey();
  if (callbackKey && isLegacyAuditCallbackPath(req) && token && safeEqual(token, callbackKey)) {
    req.aimsAuth = { strategy: "audit-callback-bearer" };
    return next();
  }

  return res
    .status(401)
    .set("WWW-Authenticate", "Bearer")
    .json({ ok: false, error: "unauthorized" });
}

export default requireAimsBearerAuth;
