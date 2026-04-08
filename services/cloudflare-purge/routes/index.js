import crypto from "node:crypto";
import express from "express";
import { info, error } from "../../../logger.js";
import {
  validateBody,
  cloudflarePurgeBodySchema,
} from "../../shared/utils/requestSchemas.js";
import { purgeCloudflareCache } from "../utils/purgeCloudflareCache.js";

const router = express.Router();

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function normaliseEnvString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function isProductionEnv(value = process.env.NODE_ENV) {
  return normaliseEnvString(value).toLowerCase() === "production";
}

function getPurgeMode(body = {}) {
  if (body?.purge_everything === true) return "purge_everything";
  if (Array.isArray(body?.files)) return "files";
  if (Array.isArray(body?.tags)) return "tags";
  if (Array.isArray(body?.hosts)) return "hosts";
  if (Array.isArray(body?.prefixes)) return "prefixes";
  return "invalid";
}

function getPurgeCounts(body = {}) {
  return {
    files: Array.isArray(body.files) ? body.files.length : 0,
    tags: Array.isArray(body.tags) ? body.tags.length : 0,
    hosts: Array.isArray(body.hosts) ? body.hosts.length : 0,
    prefixes: Array.isArray(body.prefixes) ? body.prefixes.length : 0,
  };
}

function getRouteSecret() {
  return normaliseEnvString(process.env.CLOUDFLARE_PURGE_SHARED_SECRET);
}

function readProvidedSecret(req) {
  const headerValue = req.get("x-cloudflare-purge-secret") || req.get("x-internal-token") || "";
  return normaliseEnvString(headerValue);
}

function timingSafeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left), "utf8");
  const rightBuffer = Buffer.from(String(right), "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requireRouteSecret(req, res, next) {
  const configuredSecret = getRouteSecret();

  if (!configuredSecret) {
    if (isProductionEnv()) {
      return res.status(503).json({
        ok: false,
        error: "Cloudflare purge route is disabled. Missing CLOUDFLARE_PURGE_SHARED_SECRET.",
      });
    }

    return next();
  }

  const providedSecret = readProvidedSecret(req);
  if (!providedSecret) {
    return res.status(401).json({
      ok: false,
      error: "Missing Cloudflare purge secret.",
    });
  }

  if (!timingSafeEqualText(providedSecret, configuredSecret)) {
    return res.status(403).json({
      ok: false,
      error: "Invalid Cloudflare purge secret.",
    });
  }

  return next();
}

router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "cloudflare-purge",
    configured: Boolean(process.env.CF_zone?.trim() && process.env.CF_purge?.trim()),
    protected: Boolean(getRouteSecret()),
    enabled: !isProductionEnv() || Boolean(getRouteSecret()),
    time: new Date().toISOString(),
  });
});

router.post("/purge", requireRouteSecret, asyncRoute(async (req, res) => {
  const parsed = validateBody(cloudflarePurgeBodySchema, req.body);
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }

  const payload = parsed.data;
  const mode = getPurgeMode(payload);

  info("cloudflare.purge.request", {
    mode,
    counts: getPurgeCounts(payload),
    requestId: req.id || req.headers["x-request-id"] || null,
  });

  try {
    const result = await purgeCloudflareCache(payload);

    info("cloudflare.purge.complete", {
      mode: result.mode,
      requestId: result.result?.id || null,
    });

    return res.json({
      ok: true,
      service: "cloudflare-purge",
      ...result,
    });
  } catch (err) {
    const statusCode = err?.statusCode || err?.status || 500;

    error("cloudflare.purge.fail", {
      mode,
      statusCode,
      error: err?.message || String(err),
    });

    return res.status(statusCode).json({
      ok: false,
      error: err?.message || "Cloudflare purge failed",
    });
  }
}));

export default router;
