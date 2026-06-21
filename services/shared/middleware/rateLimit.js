import { warn } from "../../../logger.js";

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 60;
const buckets = globalThis.__AI_MANAGEMENT_RATE_LIMIT_BUCKETS__ || new Map();
const cleanupState = globalThis.__AI_MANAGEMENT_RATE_LIMIT_CLEANUP__ || { timer: null };

globalThis.__AI_MANAGEMENT_RATE_LIMIT_BUCKETS__ = buckets;
globalThis.__AI_MANAGEMENT_RATE_LIMIT_CLEANUP__ = cleanupState;

function normaliseEnvString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function isProductionEnv(value = process.env.NODE_ENV) {
  return normaliseEnvString(value).toLowerCase() === "production";
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalised = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalised)) return true;
  if (["0", "false", "no", "off"].includes(normalised)) return false;
  return fallback;
}

function scheduleCleanup(windowMs) {
  if (cleanupState.timer) return;
  cleanupState.timer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of buckets.entries()) {
      if (!entry || entry.resetAt <= now) {
        buckets.delete(key);
      }
    }
  }, Math.max(15_000, windowMs));

  cleanupState.timer.unref?.();
}

function getClientId(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function shouldSkip(req) {
  const path = String(req.path || req.originalUrl || req.url || "/").split("?")[0].replace(/\/+$/, "") || "/";
  if (["/", "/health", "/livez", "/readyz"].includes(path)) return true;
  return path.toLowerCase().endsWith("/health");
}

export function createRateLimitMiddleware(options = {}) {
  const windowMs = Number(options.windowMs || process.env.RATE_LIMIT_WINDOW_MS || DEFAULT_WINDOW_MS);
  const maxRequests = Number(options.maxRequests || process.env.RATE_LIMIT_MAX_REQUESTS || DEFAULT_MAX_REQUESTS);
  const enabled = parseBoolean(
    options.enabled ?? process.env.RATE_LIMIT_ENABLED,
    isProductionEnv()
  );

  if (!enabled) {
    return (_req, _res, next) => next();
  }

  scheduleCleanup(windowMs);

  return (req, res, next) => {
    if (shouldSkip(req)) return next();

    const key = `${getClientId(req)}:${req.method}`;
    const now = Date.now();
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    current.count += 1;
    if (current.count <= maxRequests) {
      return next();
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    res.setHeader("Retry-After", String(retryAfterSeconds));

    warn("rate.limit.exceeded", {
      method: req.method,
      path: req.originalUrl || req.url,
      ip: getClientId(req),
      retryAfterSeconds,
      requestId: req.id || req.headers["x-request-id"] || null,
    });

    return res.status(429).json({
      ok: false,
      error: "Rate limit exceeded",
      retryAfterSeconds,
      requestId: req.id || req.headers["x-request-id"] || null,
    });
  };
}

export default createRateLimitMiddleware;
