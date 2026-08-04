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

function usableSecret(value) {
  const normalised = normalise(value);
  return looksLikeSecretPlaceholder(normalised) ? "" : normalised;
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
  return usableSecret(process.env.AIMS_API_KEY || process.env.AI_SUITE_API_KEY);
}

function expectedAuditCallbackKey() {
  return usableSecret(process.env.AUDIT_CALLBACK_TOKEN || process.env.AI_SUITE_AUDIT_CALLBACK_TOKEN);
}

function expectedCloudflarePurgeSecret() {
  return usableSecret(process.env.CLOUDFLARE_PURGE_SHARED_SECRET);
}

function expectedSiteShellSyncSecret() {
  return usableSecret(process.env.SITE_SHELL_SYNC_SHARED_SECRET) || expectedCloudflarePurgeSecret();
}

function expectedBlotatoPublishSecret() {
  return usableSecret(process.env.BLOTATO_PUBLISH_WEBHOOK_SECRET || process.env.BLOTATO_WEBHOOK_SECRET);
}

function allowsPublicCloudflarePurge() {
  if (!isProductionEnv()) return true;
  return truthy(process.env.CLOUDFLARE_PURGE_ALLOW_PUBLIC);
}

function allowsPublicBlotatoPublishHooks() {
  if (!isProductionEnv()) return true;
  return truthy(process.env.BLOTATO_ALLOW_PUBLIC_PUBLISH_HOOKS);
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


export function isBlotatoPublishTriggerPath(req) {
  const method = String(req.method || "").toUpperCase();
  const path = pathWithoutQuery(req).replace(/\/+$/, "").toLowerCase();

  return method === "POST" && /^\/blotato\/shorts\/(news-insight|model-verdict|ai-at-work|reality-check|ai-playbook)\/publish-now$/.test(path);
}

export function isPublicBlotatoPublishPath(req) {
  const method = String(req.method || "").toUpperCase();
  const path = pathWithoutQuery(req).replace(/\/+$/, "").toLowerCase();

  if (isBlotatoPublishTriggerPath(req)) return true;

  if (["GET", "HEAD"].includes(method) && path.startsWith("/blotato/jobs/")) {
    return true;
  }

  return false;
}

export function isPublicCommsHubIntakePath(req) {
  const method = String(req.method || "").toUpperCase();
  const path = pathWithoutQuery(req).replace(/\/+$/, "").toLowerCase();
  return method === "POST" && [
    "/comms-hub/intake/jotform",
    "/comms-hub/intake/zernio/meta",
    "/comms-hub/intake/zernio/video",
    "/comms-hub/intake/chat",
  ].includes(path);
}

export function isCloudflarePurgePath(req) {
  const method = String(req.method || "").toUpperCase();
  if (method !== "POST") return false;
  const path = pathWithoutQuery(req).replace(/\/+$/, "").toLowerCase();
  return path === "/cloudflare/purge";
}

export function isSiteShellSyncPath(req) {
  const method = String(req.method || "").toUpperCase();
  if (method !== "POST") return false;
  const path = pathWithoutQuery(req).replace(/\/+$/, "").toLowerCase();
  return path === "/cloudflare/site-shell/sync";
}

function extractCloudflarePurgeSecret(req) {
  return normalise(req.get?.("x-cloudflare-purge-secret") || req.headers?.["x-cloudflare-purge-secret"]);
}

function extractBlotatoPublishSecret(req) {
  return normalise(
    req.get?.("x-blotato-publish-secret") ||
      req.get?.("x-aims-webhook-secret") ||
      req.headers?.["x-blotato-publish-secret"] ||
      req.headers?.["x-aims-webhook-secret"]
  );
}

export function getCloudflarePurgeAuthStrategy(req) {
  const expected = expectedSuiteKey();
  const bearer = extractBearerToken(req);

  if (expected && bearer && safeEqual(bearer, expected)) {
    return "suite-bearer";
  }

  const purgeSecret = expectedCloudflarePurgeSecret();
  const providedPurgeSecret = extractCloudflarePurgeSecret(req);
  if (purgeSecret && providedPurgeSecret && safeEqual(providedPurgeSecret, purgeSecret)) {
    return "cloudflare-purge-secret";
  }

  if (allowsPublicCloudflarePurge()) {
    return "public-cloudflare-purge";
  }

  return null;
}


export function getSiteShellSyncAuthStrategy(req) {
  const expected = expectedSuiteKey();
  const bearer = extractBearerToken(req);

  if (expected && bearer && safeEqual(bearer, expected)) {
    return "suite-bearer";
  }

  const syncSecret = expectedSiteShellSyncSecret();
  const providedSyncSecret = extractCloudflarePurgeSecret(req);
  if (syncSecret && providedSyncSecret && safeEqual(providedSyncSecret, syncSecret)) {
    return "site-shell-sync-secret";
  }

  // This deployment bridge is intentionally never public, even when the
  // legacy Cloudflare purge route has been explicitly opened.
  return null;
}

export function getBlotatoPublishAuthStrategy(req) {
  const expected = expectedSuiteKey();
  const bearer = extractBearerToken(req);

  if (expected && bearer && safeEqual(bearer, expected)) {
    return "suite-bearer";
  }

  const publishSecret = expectedBlotatoPublishSecret();
  const providedSecret = extractBlotatoPublishSecret(req);
  if (publishSecret && providedSecret && safeEqual(providedSecret, publishSecret)) {
    return "blotato-publish-secret";
  }

  if (allowsPublicBlotatoPublishHooks()) {
    return "public-blotato-publish-hook";
  }

  return null;
}

export function requireAimsBearerAuth(req, res, next) {
  if (String(req.method || "").toUpperCase() === "OPTIONS") return next();
  if (isPublicHealthRequest(req)) return next();

  if (isPublicCommsHubIntakePath(req)) {
    const path = pathWithoutQuery(req).replace(/\/+$/, "").toLowerCase();
    req.aimsAuth = {
      strategy: path === "/comms-hub/intake/jotform"
        ? "jotform-api-reverification"
        : "zernio-hmac-sha256",
    };
    return next();
  }

  if (isBlotatoPublishTriggerPath(req)) {
    const strategy = getBlotatoPublishAuthStrategy(req);
    if (strategy) {
      req.aimsAuth = { strategy };
      return next();
    }
    return res
      .status(401)
      .set("WWW-Authenticate", "Bearer")
      .json({ ok: false, error: "unauthorized", hint: "Set BLOTATO_PUBLISH_WEBHOOK_SECRET or use the AIMS bearer token for publish-now triggers." });
  }

  if (isPublicBlotatoPublishPath(req)) return next();

  if (isSiteShellSyncPath(req)) {
    const strategy = getSiteShellSyncAuthStrategy(req);
    if (strategy) {
      req.aimsAuth = { strategy };
      return next();
    }
    return res
      .status(401)
      .set("WWW-Authenticate", "Bearer")
      .json({ ok: false, error: "unauthorized", hint: "Use the AIMS bearer token or SITE_SHELL_SYNC_SHARED_SECRET for the internal site-shell deployment bridge." });
  }

  if (isCloudflarePurgePath(req)) {
    const strategy = getCloudflarePurgeAuthStrategy(req);
    if (strategy) {
      req.aimsAuth = { strategy };
      return next();
    }
    return res
      .status(401)
      .set("WWW-Authenticate", "Bearer")
      .json({ ok: false, error: "unauthorized", hint: "Use the AIMS bearer token or CLOUDFLARE_PURGE_SHARED_SECRET for Cloudflare purge requests." });
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
